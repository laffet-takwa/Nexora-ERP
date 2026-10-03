<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\Order;
use App\Models\Product;
use App\Models\SystemSetting;
use App\Services\AuditLogger;
use App\Services\BusinessNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
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
            // Half-open range comparison keeps the (status, created_at) index usable.
            $from = Carbon::parse($request->query('from'))->startOfDay();
            $to = $request->filled('to')
                ? Carbon::parse($request->query('to'))->endOfDay()
                : $from->copy()->endOfDay();
            $query->whereBetween('created_at', [$from, $to]);
        }
        if ($request->filled('to') && ! $request->filled('from')) {
            $day = Carbon::parse($request->query('to'));
            $query->whereBetween('created_at', [$day->copy()->startOfDay(), $day->endOfDay()]);
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
            'items.*.tax_rate' => ['sometimes', 'numeric'],
        ]);

        $allowedTaxRates = $this->allowedTaxRates();
        $defaultTaxRate = $allowedTaxRates[0];

        $order = DB::transaction(function () use ($data, $allowedTaxRates, $defaultTaxRate, $request): Order {
            // Lock in ascending id order so two concurrent orders touching the same
            // products cannot deadlock by acquiring the same rows in opposite order.
            $productIds = collect($data['items'])->pluck('product_id')->sort()->values()->all();
            $products = Product::query()->whereIn('id', $productIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $lines = [];
            $subtotal = 0.0;
            $taxTotal = 0.0;
            foreach ($data['items'] as $line) {
                $product = $products[$line['product_id']] ?? null;
                if (! $product) {
                    throw ValidationException::withMessages(['items' => 'Unknown product in order.']);
                }
                if ($product->status !== 'active') {
                    throw ValidationException::withMessages(['items' => "Product {$product->sku} is inactive."]);
                }
                if ($line['quantity'] > $product->stock_quantity) {
                    throw ValidationException::withMessages(['items' => "Insufficient stock for product {$product->sku}."]);
                }

                // The backend owns the tax rate; a client may only pick a configured one.
                if (array_key_exists('tax_rate', $line) && ! in_array(round((float) $line['tax_rate'], 2), $allowedTaxRates, true)) {
                    throw ValidationException::withMessages([
                        'items' => 'The requested tax rate is not configured. Allowed rates: '.implode(', ', $allowedTaxRates).'.',
                    ]);
                }
                $rate = round((float) ($line['tax_rate'] ?? $defaultTaxRate), 2);

                $gross = (float) $product->selling_price * $line['quantity'];
                $lineDiscount = (float) ($line['discount'] ?? 0);
                if ($lineDiscount > $gross) {
                    throw ValidationException::withMessages(['items' => "Discount exceeds the value of product {$product->sku}."]);
                }
                $net = $gross - $lineDiscount;
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

    /**
     * Tax rates the server is willing to apply.
     *
     * Authoritative source is the `finance.tax_rates` system setting. With nothing
     * configured the only permitted rate is 0, so a client can never invent a tax
     * figure by omitting or guessing the field.
     */
    protected function allowedTaxRates(): array
    {
        $configured = SystemSetting::query()->where('key', 'finance.tax_rates')->value('value');

        if (! is_array($configured)) {
            return [0.0];
        }

        $rates = array_values(array_unique(array_map(
            fn ($rate) => round((float) $rate, 2),
            array_filter($configured, fn ($rate) => is_numeric($rate) && (float) $rate >= 0 && (float) $rate <= 100),
        )));

        sort($rates);

        return $rates === [] ? [0.0] : $rates;
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
                foreach ($lockedOrder->items->sortBy('product_id')->values() as $item) {
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
                        'delta' => -$item->quantity,
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
                // A threshold of 0 means "no reorder point", not "always out of stock".
                if ($item->product
                    && $item->product->minimum_stock_level > 0
                    && $item->product->stock_quantity <= $item->product->minimum_stock_level) {
                    $notifier->notifyAdministrators('low_stock', 'Product '.$item->product->name.' is low in stock.', ['product_id' => $item->product_id]);
                }
            }
        }

        return response()->json($order->fresh()->load(['customer', 'items']));
    }
}