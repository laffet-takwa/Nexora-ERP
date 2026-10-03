<?php

use App\Models\Invoice;
use App\Models\Payment;
use App\Notifications\BusinessNotification;
use App\Services\InvoiceState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * Regression tests for the nightly `paid -> overdue` race.
 *
 * The command used to hydrate models outside a transaction and save
 * unconditionally, so a payment settling an invoice between the read and the
 * write was silently undone.
 *
 * An invoice is issued with a future due date and the due date is then moved into
 * the past, which is the realistic path into this state.
 */

/** Move an issued invoice's due date into the past without re-syncing its state. */
function makePastDue(Invoice $invoice): Invoice
{
    $invoice->update(['due_date' => today()->subDay()->toDateString()]);

    return $invoice->fresh();
}

it('marks an unpaid invoice past its due date as overdue', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = makePastDue($this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]));

    $this->artisan('invoices:mark-overdue')->assertSuccessful();

    $invoice->refresh();
    expect($invoice->due_status)->toBe('overdue')
        ->and($invoice->status)->toBe('overdue')
        ->and($invoice->payment_status)->toBe('unpaid');
});

it('never downgrades a paid invoice to overdue', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]);
    $this->payInvoice($invoice, (float) $invoice->total);
    makePastDue($invoice);

    $this->artisan('invoices:mark-overdue')->assertSuccessful();

    $invoice->refresh();
    expect($invoice->status)->toBe('paid')
        ->and($invoice->payment_status)->toBe('paid');
});

it('does not overwrite a partially paid invoice with overdue', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]);
    $this->payInvoice($invoice, 100);
    makePastDue($invoice);

    $this->artisan('invoices:mark-overdue')->assertSuccessful();

    $invoice->refresh();
    // Lateness is recorded, but the payment progress is preserved.
    expect($invoice->due_status)->toBe('overdue')
        ->and($invoice->payment_status)->toBe('partially_paid')
        ->and($invoice->status)->toBe('overdue');
});

it('simultaneously represents a partially paid invoice that is past due', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]);
    $this->payInvoice($invoice, 100);
    makePastDue($invoice);

    $this->artisan('invoices:mark-overdue')->assertSuccessful();

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('partially_paid')
        ->and($invoice->due_status)->toBe('overdue');
});

it('affects zero rows when the invoice changed state between read and write', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = makePastDue($this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]));

    // This is exactly what the command's candidate query returns.
    $candidates = Invoice::query()->overdueCandidates()->get(['id', 'invoice_number']);
    expect($candidates)->toHaveCount(1);

    // A payment settles the invoice after the command has already read it.
    Payment::create([
        'invoice_id' => $invoice->id,
        'customer_id' => $invoice->customer_id,
        'amount' => (float) $invoice->total,
        'method' => 'bank_transfer',
        'payment_date' => now(),
    ]);
    $invoice->refresh()->syncState();
    expect($invoice->payment_status)->toBe('paid');

    // The conditional update must now match nothing.
    $affected = InvoiceState::overdueScope(Invoice::query()->whereKey($invoice->id))
        ->where('due_date', '<', today()->toDateString())
        ->update(['due_status' => 'overdue', 'status' => 'overdue']);

    expect($affected)->toBe(0)
        ->and($invoice->fresh()->status)->toBe('paid');
});

it('sends no overdue notification when the conditional update affects no rows', function (): void {
    $administrator = $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = makePastDue($this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]));

    // Simulate the read/write interleaving: the invoice is settled after the
    // command has chosen it as a candidate but before it writes.
    Payment::create([
        'invoice_id' => $invoice->id,
        'customer_id' => $invoice->customer_id,
        'amount' => (float) $invoice->total,
        'method' => 'bank_transfer',
        'payment_date' => now(),
    ]);
    $invoice->refresh()->syncState();
    expect($invoice->payment_status)->toBe('paid');

    Notification::fake();
    $this->artisan('invoices:mark-overdue')
        ->expectsOutput('0 invoice(s) marked overdue.')
        ->assertSuccessful();

    Notification::assertNothingSent();
    expect($invoice->fresh()->status)->toBe('paid');
});

it('sends exactly one overdue notification per invoice actually transitioned', function (): void {
    $administrator = $this->actingAsAdministrator();
    ['order_id' => $firstOrder] = $this->createOrder();
    ['order_id' => $secondOrder] = $this->createOrder();

    makePastDue($this->createInvoice($firstOrder, ['due_date' => today()->addDays(30)->toDateString()]));
    makePastDue($this->createInvoice($secondOrder, ['due_date' => today()->addDays(30)->toDateString()]));

    Notification::fake();
    $this->artisan('invoices:mark-overdue')
        ->expectsOutput('2 invoice(s) marked overdue.')
        ->assertSuccessful();

    // Both notifications must be the overdue event, one per transitioned invoice.
    $events = Notification::sent($administrator, BusinessNotification::class)
        ->map(fn (BusinessNotification $notification): mixed => $notification->toDatabase($administrator)['event'] ?? null)
        ->values();

    expect($events)->toHaveCount(2)
        ->and($events->filter(fn ($event): bool => $event === 'invoice_overdue'))->toHaveCount(2);

    // Running again is a no-op: nothing is left to transition, so nothing is announced.
    Notification::fake();
    $this->artisan('invoices:mark-overdue')
        ->expectsOutput('0 invoice(s) marked overdue.')
        ->assertSuccessful();

    Notification::assertNothingSent();
});

it('ignores invoices that are not past their due date', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDay()->toDateString()]);

    $this->artisan('invoices:mark-overdue')
        ->expectsOutput('0 invoice(s) marked overdue.')
        ->assertSuccessful();

    expect($invoice->fresh()->status)->toBe('pending');
});

it('leaves cancelled and void invoices untouched', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = makePastDue($this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]));
    $invoice->update(['status' => 'cancelled']);

    $this->artisan('invoices:mark-overdue')
        ->expectsOutput('0 invoice(s) marked overdue.')
        ->assertSuccessful();

    expect($invoice->fresh()->status)->toBe('cancelled');
});

it('keeps the invoice totals consistent across every state transition', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]);
    $total = (float) $invoice->total;
    makePastDue($invoice);

    $this->payInvoice($invoice, $total - 250);
    $this->artisan('invoices:mark-overdue')->assertSuccessful();
    $this->payInvoice($invoice, 250);

    $invoice->refresh();
    expect((float) $invoice->total)->toBe($total)
        ->and($invoice->payment_status)->toBe('paid')
        ->and($invoice->due_status)->toBe('overdue')
        ->and($invoice->status)->toBe('paid')
        ->and($invoice->remainingAmount())->toBe(0.0);
});