<?php

namespace App\Services;

use App\Models\Invoice;

/**
 * Single source of truth for invoice state.
 *
 * Payment progress and calendar lateness are two independent facts, so they are
 * stored in their own columns (`payment_status`, `due_status`). The legacy
 * `status` column is kept in sync as a denormalised compatibility value for
 * existing database filters and API consumers; every writer goes through here so
 * it cannot drift.
 */
class InvoiceState
{
    /** Lifecycle states that stop payment and overdue processing. */
    public const CLOSED_STATES = ['draft', 'cancelled', 'void'];

    public const PAYMENT_STATES = ['unpaid', 'partially_paid', 'paid'];

    public const DUE_STATES = ['current', 'overdue'];

    /**
     * An invoice with nothing owed is settled: a zero-total invoice never needs a
     * payment row to reach `paid`, so it can never be stranded as overdue.
     */
    public static function paymentStatusFor(float $total, float $paid): string
    {
        if ($total <= 0.0) {
            return 'paid';
        }

        if (round($paid, 3) >= round($total, 3)) {
            return 'paid';
        }

        return $paid > 0.0 ? 'partially_paid' : 'unpaid';
    }

    public static function dueStatusFor(?string $dueDate): string
    {
        if ($dueDate === null || $dueDate === '') {
            return 'current';
        }

        return $dueDate < today()->toDateString() ? 'overdue' : 'current';
    }

    /**
     * Derive payment_status and due_status from the payment ledger and calendar,
     * then synchronise the legacy `status` column.
     *
     * Closed invoices keep their lifecycle status and are left untouched.
     */
    public static function sync(Invoice $invoice): Invoice
    {
        if (in_array($invoice->status, self::CLOSED_STATES, true)) {
            return $invoice;
        }

        $paymentStatus = self::paymentStatusFor(
            (float) $invoice->total,
            (float) $invoice->payments()->sum('amount'),
        );
        $dueStatus = self::dueStatusFor($invoice->due_date?->toDateString());

        $invoice->payment_status = $paymentStatus;
        $invoice->due_status = $dueStatus;
        $invoice->status = self::legacyStatusFor($paymentStatus, $dueStatus);
        $invoice->save();

        return $invoice;
    }

    /**
     * Collapse the two dimensions back into the original single-value enum.
     *
     * A settled invoice stays `paid` even when overdue, which is what preserves
     * the previous contract that a paid invoice is never marked overdue.
     */
    public static function legacyStatusFor(string $paymentStatus, string $dueStatus): string
    {
        return match ($paymentStatus) {
            'paid' => 'paid',
            'partially_paid' => $dueStatus === 'overdue' ? 'overdue' : 'partially_paid',
            default => $dueStatus === 'overdue' ? 'overdue' : 'pending',
        };
    }

    /**
 * Rows that may still transition to overdue, re-asserted inside the UPDATE so a
 * payment that commits between the read and the write cannot be clobbered, and
 * an invoice that is already overdue is not re-transitioned (and re-announced)
 * on every subsequent run.
 */
    public static function overdueScope($query)
    {
        return $query
            ->where('payment_status', '!=', 'paid')
            ->whereNotIn('status', self::CLOSED_STATES)
            ->where('due_status', '!=', 'overdue');
    }
}