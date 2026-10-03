<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\Payment;
use App\Services\AuditLogger;
use App\Services\BusinessNotifier;
use App\Services\InvoiceState;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentController extends Controller
{
    public function index(Request $request)
    {
        $query = Payment::with(['invoice:id,invoice_number', 'customer:id,first_name,last_name', 'receiver:id,name', 'refundsPayment:id,amount,method']);
        if ($request->filled('method')) {
            $query->where('method', $request->query('method'));
        }
        if ($request->filled('from')) {
            // Range comparison keeps the payment_date index usable; whereDate() would wrap the column.
            $from = $request->query('from').' 00:00:00';
            $to = ($request->query('to') ?? $request->query('from')).' 23:59:59';
            $query->whereBetween('payment_date', [$from, $to]);
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

        [$payment, $invoiceNumber] = DB::transaction(function () use ($data, $request): array {
            $invoice = Invoice::query()->lockForUpdate()->findOrFail($data['invoice_id']);
            if (! $invoice->isOpenForPayment()) {
                throw ValidationException::withMessages(['invoice_id' => 'Payments cannot be recorded for closed invoices.']);
            }

            $remaining = $invoice->remainingAmount();
            $amount = round((float) $data['amount'], 3);
            if ($amount > $remaining) {
                throw ValidationException::withMessages(['amount' => 'Payment exceeds the remaining invoice balance.']);
            }

            $payment = Payment::create([
                ...$data,
                'amount' => $amount,
                'customer_id' => $invoice->customer_id,
                'received_by' => $request->user()->id,
                'payment_date' => $data['payment_date'] ?? now(),
            ]);

            // Authoritative state comes from the ledger, not the local arithmetic.
            InvoiceState::sync($invoice);

            return [$payment, $invoice->invoice_number];
        });
        $audit->record($request, 'payment_received', 'payment', $payment->id, ['invoice_id' => $payment->invoice_id, 'amount' => $payment->amount]);
        $notifier->notifyAdministrators('payment_received', 'Payment received for invoice '.$invoiceNumber.'.', ['payment_id' => $payment->id, 'invoice_id' => $payment->invoice_id]);

        return response()->json($payment->load(['invoice', 'customer', 'receiver']), 201);
    }

    /**
     * Refund a payment by writing a compensating negative entry.
     *
     * The original row is never modified or deleted, and the invoice state is
     * recomputed from the resulting ledger balance.
     */
    public function refund(Request $request, Payment $payment, AuditLogger $audit, BusinessNotifier $notifier)
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0'],
            'reason' => ['required', 'string', 'max:255'],
            'payment_date' => ['sometimes', 'date'],
        ]);

        [$refund, $invoiceNumber] = DB::transaction(function () use ($payment, $data, $request): array {
            $original = Payment::query()->lockForUpdate()->findOrFail($payment->getKey());

            if ($original->refunds_payment_id !== null) {
                throw ValidationException::withMessages(['payment' => 'A refund cannot itself be refunded.']);
            }

            $invoice = Invoice::query()->lockForUpdate()->findOrFail($original->invoice_id);
            if (! $invoice->isOpenForPayment()) {
                throw ValidationException::withMessages(['payment' => 'Refunds cannot be recorded against a closed invoice.']);
            }

            $alreadyRefunded = (float) $original->refunds()->sum('amount');
            $refundable = round((float) $original->amount - abs($alreadyRefunded), 3);
            $amount = round((float) $data['amount'], 3);

            if ($amount > $refundable) {
                throw ValidationException::withMessages([
                    'amount' => 'Refund exceeds the refundable amount of '.number_format($refundable, 3, '.', '').'.',
                ]);
            }

            $refund = Payment::create([
                'invoice_id' => $invoice->id,
                'customer_id' => $invoice->customer_id,
                'received_by' => $request->user()->id,
                'refunds_payment_id' => $original->id,
                'amount' => -$amount,
                'method' => $original->method,
                'payment_date' => $data['payment_date'] ?? now(),
                'reference' => $original->reference,
                'notes' => $data['reason'],
            ]);

            InvoiceState::sync($invoice);

            return [$refund, $invoice->invoice_number];
        });

        $audit->record($request, 'payment_refunded', 'payment', $refund->id, [
            'original_payment_id' => $payment->getKey(),
            'amount' => $refund->amount,
            'reason' => $data['reason'],
        ]);
        $notifier->notifyAdministrators('payment_refunded', 'Payment refunded on invoice '.$invoiceNumber.'.', [
            'payment_id' => $payment->getKey(),
            'refund_id' => $refund->id,
        ]);

        return response()->json($refund->load(['invoice', 'customer', 'receiver']), 201);
    }
}