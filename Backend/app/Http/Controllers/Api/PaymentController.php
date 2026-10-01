<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\Payment;
use App\Services\AuditLogger;
use App\Services\BusinessNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentController extends Controller
{
    public function index(Request $request)
    {
        $query = Payment::with(['invoice:id,invoice_number', 'customer:id,first_name,last_name', 'receiver:id,name']);
        if ($request->filled('method')) {
            $query->where('method', $request->query('method'));
        }
        if ($request->filled('from')) {
            $query->whereDate('payment_date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $query->whereDate('payment_date', '<=', $request->query('to'));
        }
        if ($search = $request->query('search')) {
            $query->whereHas('invoice', fn ($invoice) => $invoice->where('invoice_number', 'like', "%{$search}%"));
        }

        return $query->latest('payment_date')->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function store(Request $request, AuditLogger $audit, BusinessNotifier $notifier)
    {
        $data = $request->validate([
            'invoice_id' => ['required', 'integer', 'exists:invoices,id'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'method' => ['required', 'in:cash,bank_transfer,card,cheque,other'],
            'payment_date' => ['sometimes', 'date'],
            'reference' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
        ]);

        [$payment, $newStatus] = DB::transaction(function () use ($data, $request): array {
            $invoice = Invoice::query()->lockForUpdate()->findOrFail($data['invoice_id']);
            if (in_array($invoice->status, ['draft', 'cancelled'], true)) {
                throw ValidationException::withMessages(['invoice_id' => 'Payments cannot be recorded for draft or cancelled invoices.']);
            }
            $paid = (float) $invoice->payments()->sum('amount');
            $remaining = round((float) $invoice->total - $paid, 3);
            $amount = round((float) $data['amount'], 3);
            if ($amount > $remaining) {
                throw ValidationException::withMessages(['amount' => 'Payment exceeds the remaining invoice balance.']);
            }

            $payment = Payment::create([
                ...$data,
                'customer_id' => $invoice->customer_id,
                'received_by' => $request->user()->id,
                'payment_date' => $data['payment_date'] ?? now(),
            ]);
            $newPaid = round($paid + $amount, 3);
            $newStatus = $newPaid >= (float) $invoice->total
                ? 'paid'
                : ($invoice->due_date?->isBefore(today()) ? 'overdue' : ($newPaid > 0 ? 'partially_paid' : 'pending'));
            $invoice->update(['status' => $newStatus]);

            return [$payment, $newStatus];
        });
        $audit->record($request, 'payment_received', 'payment', $payment->id, ['invoice_id' => $payment->invoice_id, 'status' => $newStatus]);
        $notifier->notifyAdministrators('payment_received', 'Payment received for invoice '.$payment->invoice->invoice_number.'.', ['payment_id' => $payment->id, 'invoice_id' => $payment->invoice_id]);

        return response()->json($payment->load(['invoice', 'customer', 'receiver']), 201);
    }
}