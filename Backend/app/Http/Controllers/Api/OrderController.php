<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\Order;
use App\Models\Product;
use App\Services\AuditLogger;
use App\Services\BusinessNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        $query = Order::with('customer');
        if ($search = $request->query('search')) {
            $query->where(fn ($builder) => $builder->where('order_number', 'like', "%{$search}%")
                ->orWhereHas('customer', fn ($customer) => $customer->where('first_name', 'like', "%{$search}%")
                    ->orWhere('last_name', 'like', "%{$search}%")));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('from')) {
            $query->whereDate('created_at', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $query->whereDate('created_at', '<=', $request->query('to'));
        }

        return $query->latest()->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function store(Request $request, AuditLogger $audit, BusinessNotifier $notifier)
    {
        $data = $request->validate([
            'customer_id' => ['required', 'integer', 'exists:customers,id'],
            'discount' => ['sometimes', 'numeric', 'min:0'],
            'notes' => ['nullable', 'string'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'distinct', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'items.*.discount' => ['sometimes', 'numeric', 'min:0'],
            'items.*.tax_rate' => ['sometimes', 'numeric', 'between:0,100'],
        ]);

        $order = DB::transaction(function () use ($data, $request): Order {
            $lines = [];
            $subtotal = 0.0;
            $taxTotal = 0.0;
            foreach ($data['items'] as $line) {
                $product = Product::query()->lockForUpdate()->findOrFail($line['product_id']);
                if ($product->status !== 'active') {
                    throw ValidationException::withMessages(['items' => "Product {$product->sku} is inactive."]);
                }
                if ($line['quantity'] > $product->stock_quantity) {
                    throw ValidationException::withMessages(['items' => "Insufficient stock for product {$product->sku}."]);
                }

                $gross = (float) $product->selling_price * $line['quantity'];
                $lineDiscount = (float) ($line['discount'] ?? 0);
                if ($lineDiscount > $gross) {
                    throw ValidationException::withMessages(['items' => "Discount exceeds the value of product {$product->sku}."]);
                }
                $net = $gross - $lineDiscount;
                $rate = (float) ($line['tax_rate'] ?? 0);
                $lineTax = round($net * $rate / 100, 3);
                $subtotal += $net;
                $taxTotal += $lineTax;
                $lines[] = [
                    'product' => $product,
                    'quantity' => $line['quantity'],
                    'discount' => $lineDiscount,
                    'tax_rate' => $rate,
                    'line_total' => $net + $lineTax,
                ];
            }

            $orderDiscount = (float) ($data['discount'] ?? 0);
            if ($orderDiscount > $subtotal + $taxTotal) {
                throw ValidationException::withMessages(['discount' => 'Discount cannot exceed the order value.']);
            }
            $order = Order::create([
                'order_number' => 'ORD-'.now()->format('Ymd').'-'.strtoupper(bin2hex(random_bytes(3))),
                'customer_id' => $data['customer_id'],
                'created_by' => $request->user()->id,
                'status' => 'pending',
                'subtotal' => round($subtotal, 3),
                'tax' => round($taxTotal, 3),
                'discount' => $orderDiscount,
                'total' => round($subtotal + $taxTotal - $orderDiscount, 3),
                'notes' => $data['notes'] ?? null,
            ]);

            foreach ($lines as $line) {
                $order->items()->create([
                    'product_id' => $line['product']->id,
                    'product_name' => $line['product']->name,
                    'sku' => $line['product']->sku,
                    'quantity' => $line['quantity'],
                    'unit_price' => $line['product']->selling_price,
                    'discount' => $line['discount'],
                    'tax_rate' => $line['tax_rate'],
                    'line_total' => $line['line_total'],
                ]);
            }

            return $order;
        });

        $audit->record($request, 'created', 'order', $order->id, ['order_number' => $order->order_number]);
        $notifier->notifyAdministrators('new_order', 'New order '.$order->order_number.' created.', ['order_id' => $order->id]);

        return response()->json($order->load(['customer', 'items']), 201);
    }

    public function show(Order $order)
    {
        return $order->load(['customer', 'items.product', 'invoice.payments', 'creator']);
    }

    public function updateStatus(Request $request, Order $order, AuditLogger $audit, BusinessNotifier $notifier)
    {
        $data = $request->validate(['status' => ['required', 'in:confirmed,processing,completed,cancelled']]);
        $allowed = [
            'pending' => ['confirmed', 'cancelled'],
            'confirmed' => ['processing', 'cancelled'],
            'processing' => ['completed', 'cancelled'],
            'completed' => [],
            'cancelled' => [],
        ];
        $newStatus = $data['status'];

        DB::transaction(function () use ($order, $newStatus, $allowed, $request): void {
            $lockedOrder = Order::query()->lockForUpdate()->with('items')->findOrFail($order->id);
            if (! in_array($newStatus, $allowed[$lockedOrder->status], true)) {
                throw ValidationException::withMessages(['status' => "Cannot change order from {$lockedOrder->status} to {$newStatus}."]);
            }

            if ($newStatus === 'cancelled') {
                $invoice = $lockedOrder->invoice()->lockForUpdate()->first();
                if ($invoice) {
                    if ($invoice->payments()->exists()) {
                        throw ValidationException::withMessages(['status' => 'An order with a recorded payment cannot be cancelled.']);
                    }
                    $invoice->update(['status' => 'cancelled']);
                }
            }

            if ($newStatus === 'completed') {
                foreach ($lockedOrder->items as $item) {
                    $product = Product::query()->lockForUpdate()->findOrFail($item->product_id);
                    if ($product->stock_quantity < $item->quantity) {
                        throw ValidationException::withMessages(['stock' => "Insufficient stock for product {$product->sku}."]);
                    }
                    $product->decrement('stock_quantity', $item->quantity);
                    InventoryMovement::create([
                        'product_id' => $product->id,
                        'user_id' => $request->user()->id,
                        'type' => 'out',
                        'quantity' => $item->quantity,
                        'quantity_after' => $product->fresh()->stock_quantity,
                        'reason' => 'Order '.$lockedOrder->order_number,
                    ]);
                }
            }

            $lockedOrder->update(['status' => $newStatus]);
        });

        $audit->record($request, 'status_changed', 'order', $order->id, ['status' => $newStatus]);
        if ($newStatus === 'completed') {
            foreach ($order->fresh()->load('items.product')->items as $item) {
                if ($item->product && $item->product->stock_quantity <= $item->product->minimum_stock_level) {
                    $notifier->notifyAdministrators('low_stock', 'Product '.$item->product->name.' is low in stock.', ['product_id' => $item->product_id]);
                }
            }
        }

        return response()->json($order->fresh()->load(['customer', 'items']));
    }
}