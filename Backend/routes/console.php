<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use App\Models\Invoice;
use App\Services\BusinessNotifier;

Artisan::command('inspire', function (): void {
    $this->comment('Build with clarity.');
})->purpose('Display a short message');

Artisan::command('invoices:mark-overdue', function (BusinessNotifier $notifier): void {
    $invoices = Invoice::query()->whereIn('status', ['pending', 'partially_paid'])
        ->whereNotNull('due_date')->whereDate('due_date', '<', today())->get();

    foreach ($invoices as $invoice) {
        $invoice->update(['status' => 'overdue']);
        $notifier->notifyAdministrators('invoice_overdue', 'Invoice '.$invoice->invoice_number.' is overdue.', ['invoice_id' => $invoice->id]);
    }

    $this->info($invoices->count().' invoice(s) marked overdue.');
})->purpose('Mark unpaid invoices past their due date as overdue');

Schedule::command('invoices:mark-overdue')->dailyAt('00:15');