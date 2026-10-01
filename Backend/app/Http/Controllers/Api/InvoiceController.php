<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

class InvoiceController extends Controller
{
    public function index(Request $request)
    {
        $query = Invoice::with('customer')->withSum('payments', 'amount');
        if ($search = $request->query('search')) {
            $query->where(fn ($builder) => $builder->where('invoice_number', 'like', "%{$search}%")
                ->orWhereHas('customer', fn ($customer) => $customer->where('first_name', 'like', "%{$search}%")
                    ->orWhere('last_name', 'like', "%{$search}%")));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('from')) {
            $query->whereDate('invoice_date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $query->whereDate('invoice_date', '<=', $request->query('to'));
        }

        return $query->latest('invoice_date')->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function store(Request $request, AuditLogger $audit)
    {
        $data = $request->validate([
            'order_id' => ['required', 'integer', 'exists:orders,id'],
            'invoice_date' => ['sometimes', 'date'],
            'due_date' => ['nullable', 'date'],
        ]);
        $invoiceDate = Carbon::parse($data['invoice_date'] ?? today());
        if (! empty($data['due_date']) && Carbon::parse($data['due_date'])->lt($invoiceDate)) {
            throw ValidationException::withMessages(['due_date' => 'The due date must be on or after the invoice date.']);
        }

        $invoice = DB::transaction(function () use ($data): Invoice {
            $order = Order::query()->lockForUpdate()->with('invoice')->findOrFail($data['order_id']);
            if (in_array($order->status, ['pending', 'cancelled'], true)) {
                throw ValidationException::withMessages(['order_id' => 'Confirm the order before creating an invoice.']);
            }
            if ($order->invoice) {
                throw ValidationException::withMessages(['order_id' => 'This order already has an invoice.']);
            }

            return Invoice::create([
                'invoice_number' => 'INV-'.now()->format('Ymd').'-'.strtoupper(bin2hex(random_bytes(3))),
                'order_id' => $order->id,
                'customer_id' => $order->customer_id,
                'invoice_date' => $data['invoice_date'] ?? today(),
                'due_date' => $data['due_date'] ?? today()->addDays(30),
                'status' => 'pending',
                'subtotal' => $order->subtotal,
                'tax' => $order->tax,
                'discount' => $order->discount,
                'total' => $order->total,
            ]);
        });
        $audit->record($request, 'created', 'invoice', $invoice->id, ['invoice_number' => $invoice->invoice_number]);

        return response()->json($invoice->load(['customer', 'order.items']), 201);
    }

    public function show(Invoice $invoice)
    {
        return $invoice->load(['customer', 'order.items', 'payments.receiver'])->loadSum('payments', 'amount');
    }
}