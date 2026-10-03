<?php

use App\Models\Invoice;
use App\Models\Payment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * Financial history must never be deleted. Voiding marks an invoice and refunds
 * write a compensating negative entry, leaving both original rows intact.
 */

it('voids an unpaid invoice without deleting it', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);

    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'Issued in error'])
        ->assertOk()
        ->assertJsonPath('status', 'void')
        ->assertJsonPath('void_reason', 'Issued in error');

    expect(Invoice::whereKey($invoice->id)->exists())->toBeTrue()
        ->and($invoice->fresh()->status)->toBe('void')
        ->and($invoice->fresh()->voided_at)->not->toBeNull();
});

it('refuses to void an invoice that still holds money', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $this->payInvoice($invoice, (float) $invoice->total);

    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'Wrong customer'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('invoice');

    expect($invoice->fresh()->status)->not->toBe('void');
});

it('refuses to void an already closed invoice', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);

    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'First'])->assertOk();
    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'Second'])->assertStatus(422);
});

it('allows an invoice to be voided once its payments are refunded', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $this->payInvoice($invoice, (float) $invoice->total);

    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();
    $this->postJson("/api/v1/payments/{$payment->id}/refund", [
        'amount' => (float) $invoice->total,
        'reason' => 'Returned to customer',
    ])->assertCreated();

    expect($invoice->fresh()->payment_status)->toBe('unpaid');

    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'Wrong customer'])->assertOk();
    expect($invoice->fresh()->status)->toBe('void');
});

it('requires an administrator to void an invoice', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);

    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'nope'])->assertForbidden();
});

it('refunds a payment with a compensating entry instead of deleting it', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $total = (float) $invoice->total;
    $this->payInvoice($invoice, $total);

    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", [
        'amount' => $total,
        'reason' => 'Duplicate charge',
    ])->assertCreated();

    // The original payment is still there, untouched.
    expect(Payment::whereKey($payment->id)->exists())->toBeTrue()
        ->and((float) Payment::find($payment->id)->amount)->toBe($total);

    $refund = Payment::where('refunds_payment_id', $payment->id)->firstOrFail();
    expect((float) $refund->amount)->toBe(-$total)
        ->and($refund->notes)->toBe('Duplicate charge')
        ->and($refund->method)->toBe($payment->method);
});

it('recomputes the invoice state from the refunded ledger', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $total = (float) $invoice->total;
    $this->payInvoice($invoice, $total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => $total, 'reason' => 'Reversal'])->assertCreated();

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('unpaid')
        ->and($invoice->remainingAmount())->toBe($total);
});

it('supports partial refunds up to the recorded amount', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $total = (float) $invoice->total;
    $this->payInvoice($invoice, $total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => 250, 'reason' => 'Partial return'])
        ->assertCreated();
    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => $total - 250, 'reason' => 'Rest'])
        ->assertCreated();

    expect($payment->fresh()->refundableAmount())->toBe(0.0)
        ->and($invoice->fresh()->payment_status)->toBe('unpaid');
});

it('rejects a refund larger than the refundable amount', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $total = (float) $invoice->total;
    $this->payInvoice($invoice, $total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => 100, 'reason' => 'Part'])->assertCreated();
    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => $total, 'reason' => 'Too much'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('amount');

    expect($payment->fresh()->refundableAmount())->toBe($total - 100);
});

it('rejects a refund of zero or a negative amount', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $this->payInvoice($invoice, (float) $invoice->total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => 0, 'reason' => 'Nothing'])->assertStatus(422);
    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => -5, 'reason' => 'Backwards'])->assertStatus(422);
});

it('requires a reason for a refund', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $this->payInvoice($invoice, (float) $invoice->total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => 10])->assertStatus(422);
});

it('refuses to refund a refund', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $total = (float) $invoice->total;
    $this->payInvoice($invoice, $total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => $total, 'reason' => 'Reversal'])->assertCreated();
    $refund = Payment::where('refunds_payment_id', $payment->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$refund->id}/refund", ['amount' => 10, 'reason' => 'Again'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('payment');
});

it('requires an administrator to refund a payment', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $this->payInvoice($invoice, (float) $invoice->total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", ['amount' => 1, 'reason' => 'nope'])->assertForbidden();
});

it('records an audit trail for voids and refunds', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $this->payInvoice($invoice, (float) $invoice->total);
    $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();

    $this->postJson("/api/v1/payments/{$payment->id}/refund", [
        'amount' => (float) $invoice->total,
        'reason' => 'Duplicate charge',
    ])->assertCreated();

    $this->postJson("/api/v1/invoices/{$invoice->id}/void", ['reason' => 'Issued in error'])->assertOk();

    $this->getJson('/api/v1/audit-logs')
        ->assertOk()
        ->assertJsonFragment(['action' => 'payment_refunded', 'entity' => 'payment'])
        ->assertJsonFragment(['action' => 'voided', 'entity' => 'invoice']);
});