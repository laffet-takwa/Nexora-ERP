<?php

use App\Models\Invoice;
use App\Services\BusinessNotifier;
use App\Services\InvoiceState;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function (): void {
    $this->comment('Build with clarity.');
})->purpose('Display a short message');

/**
 * Flag past-due, unsettled invoices as overdue.
 *
 * The transition is a conditional update rather than a model save: the payment
 * status is re-asserted inside the UPDATE, so an invoice settled by a concurrent
 * request is never overwritten and never triggers a notification. No transaction
 * is held while notifications are sent.
 */
Artisan::command('invoices:mark-overdue', function (BusinessNotifier $notifier): void {
    $candidates = Invoice::query()
        ->overdueCandidates()
        ->get(['id', 'invoice_number']);

    $marked = 0;

    foreach ($candidates as $invoice) {
        $affected = InvoiceState::overdueScope(
            Invoice::query()->whereKey($invoice->getKey())
        )
            ->where('due_date', '<', today()->toDateString())
            ->update([
                'due_status' => 'overdue',
                'status' => 'overdue',
            ]);

        if ($affected !== 1) {
            // State changed between the read and the write; leave it alone.
            continue;
        }

        $marked++;
        $notifier->notifyAdministrators(
            'invoice_overdue',
            'Invoice '.$invoice->invoice_number.' is overdue.',
            ['invoice_id' => $invoice->getKey()],
        );
    }

    $this->info($marked.' invoice(s) marked overdue.');
})->purpose('Mark unpaid invoices past their due date as overdue');

Schedule::command('invoices:mark-overdue')->dailyAt('00:15');