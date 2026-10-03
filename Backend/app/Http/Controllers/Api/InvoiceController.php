<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\Order;
use App\Services\AuditLogger;
use App\Services\InvoiceState;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
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
        if ($request->filled('payment_status')) {
            $query->whereIn('payment_status', (array) $request->query('payment_status'));
        }
        if ($request->filled('due_status')) {
            $query->whereIn('due_status', (array) $request->query('due_status'));
        }
        if ($request->filled('from')) {
            // Range comparison keeps the index on invoice_date usable; whereDate() would wrap it.
            $to = $request->query('to') ?? $request->query('from');
            $query->whereBetween('invoice_date', [$request->query('from'), $to]);
        }
        if ($request->filled('to') && ! $request->filled('from')) {
            $query->whereBetween('invoice_date', [$request->query('to'), $request->query('to')]);
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

        $invoice = DB::transaction(function () use ($data, $invoiceDate): Invoice {
            $order = Order::query()->lockForUpdate()->with('invoice')->findOrFail($data['order_id']);
            if (in_array($order->status, ['pending', 'cancelled'], true)) {
                throw ValidationException::withMessages(['order_id' => 'Confirm the order before creating an invoice.']);
            }
            if ($order->invoice) {
                throw ValidationException::withMessages(['order_id' => 'This order already has an invoice.']);
            }

            $invoice = Invoice::create([
                'invoice_number' => 'INV-'.now()->format('Ymd').'-'.strtoupper(bin2hex(random_bytes(3))),
                'order_id' => $order->id,
                'customer_id' => $order->customer_id,
                'invoice_date' => $invoiceDate->toDateString(),
                'due_date' => ! empty($data['due_date']) ? $data['due_date'] : $invoiceDate->copy()->addDays(30)->toDateString(),
                'status' => 'pending',
                'payment_status' => 'unpaid',
                'due_status' => 'current',
                'subtotal' => $order->subtotal,
                'tax' => $order->tax,
                'discount' => $order->discount,
                'total' => $order->total,
            ]);

            // A zero-total invoice settles immediately instead of waiting for a payment.
            return InvoiceState::sync($invoice);
        });
        $audit->record($request, 'created', 'invoice', $invoice->id, ['invoice_number' => $invoice->invoice_number]);

        return response()->json($invoice->load(['customer', 'order.items'])->loadSum('payments', 'amount'), 201);
    }

    public function show(Invoice $invoice)
    {
        return $invoice->load(['customer', 'order.items', 'payments.receiver'])->loadSum('payments', 'amount');
    }

    /**
     * Void an incorrectly issued invoice.
     *
     * The row is kept for the audit trail and marked `void`; nothing is deleted.
     * Money still held against the invoice must be refunded first.
     */
    public function void(Request $request, Invoice $invoice, AuditLogger $audit)
    {
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:255'],
        ]);

        $voided = DB::transaction(function () use ($invoice, $data, $request): Invoice {
            $locked = Invoice::query()->lockForUpdate()->findOrFail($invoice->getKey());

            if (in_array($locked->status, InvoiceState::CLOSED_STATES, true)) {
                throw ValidationException::withMessages(['invoice' => 'This invoice is already closed.']);
            }

            if ($locked->paidAmount() > 0.0) {
                throw ValidationException::withMessages([
                    'invoice' => 'Refund the recorded payments before voiding this invoice.',
                ]);
            }

            $locked->update([
                'status' => 'void',
                'voided_at' => now(),
                'voided_by' => $request->user()->id,
                'void_reason' => $data['reason'],
            ]);

            return $locked;
        });

        $audit->record($request, 'voided', 'invoice', $voided->id, ['reason' => $data['reason']]);

        return response()->json($voided->loadSum('payments', 'amount'));
    }
}