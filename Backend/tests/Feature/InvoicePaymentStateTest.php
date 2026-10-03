<?php

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * Regression tests for the invoice payment/lateness state model.
 *
 * A single `status` column previously encoded two independent facts, so a 90%
 * paid invoice past its due date was indistinguishable from a wholly unpaid one.
 */

it('tracks an unpaid invoice that is still current', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(10)->toDateString()]);

    expect($invoice->payment_status)->toBe('unpaid')
        ->and($invoice->due_status)->toBe('current')
        ->and($invoice->status)->toBe('pending');
});

it('marks an unpaid invoice past its due date as overdue', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->subDay()->toDateString()]);

    expect($invoice->payment_status)->toBe('unpaid')
        ->and($invoice->due_status)->toBe('overdue')
        ->and($invoice->status)->toBe('overdue');
});

it('keeps a partially paid invoice partially paid while current', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(10)->toDateString()]);

    $this->payInvoice($invoice, 400);

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('partially_paid')
        ->and($invoice->due_status)->toBe('current')
        ->and($invoice->status)->toBe('partially_paid');
});

it('preserves payment progress on a partially paid invoice that is past due', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(10)->toDateString()]);

    $this->payInvoice($invoice, 400);

    // The due date passes while the invoice is still part-settled.
    $invoice->update(['due_date' => today()->subDay()->toDateString()]);
    $invoice->refresh()->syncState();

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('partially_paid')
        ->and($invoice->due_status)->toBe('overdue')
        ->and($invoice->status)->toBe('overdue')
        ->and($invoice->remainingAmount())->toBe(600.0);
});

it('settles a fully paid invoice while current', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(10)->toDateString()]);

    $this->payInvoice($invoice, (float) $invoice->total);

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('paid')
        ->and($invoice->due_status)->toBe('current')
        ->and($invoice->status)->toBe('paid');
});

it('records a paid invoice that is also past due without losing the settlement', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->subDay()->toDateString()]);

    $this->payInvoice($invoice, (float) $invoice->total);

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('paid')
        ->and($invoice->due_status)->toBe('overdue')
        ->and($invoice->status)->toBe('paid');
});

it('accepts a payment recorded after the due date', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->subDays(3)->toDateString()]);

    $this->payInvoice($invoice, (float) $invoice->total);

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('paid')
        ->and($invoice->status)->toBe('paid');
});

it('rejects a payment larger than the remaining balance', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);
    $total = (float) $invoice->total;

    $this->payInvoice($invoice, $total - 100);

    $this->postJson('/api/v1/payments', [
        'invoice_id' => $invoice->id,
        'amount' => 500,
        'method' => 'cash',
    ])->assertStatus(422)->assertJsonValidationErrors('amount');

    $invoice->refresh();
    expect($invoice->payment_status)->toBe('partially_paid')
        ->and((float) $invoice->total)->toBe($total);
});

it('settles a zero total invoice without requiring a payment', function (): void {
    $this->actingAsEmployee();

    // A 100.000 line discounted by the full 100.000 leaves nothing owed.
    $product = Product::factory()->create(['selling_price' => 100]);

    $orderId = $this->postJson('/api/v1/orders', [
        'customer_id' => Customer::factory()->create()->id,
        'items' => [['product_id' => $product->id, 'quantity' => 1, 'discount' => 100]],
    ])->assertCreated()->json('id');

    foreach (['confirmed', 'processing', 'completed'] as $status) {
        $this->patchJson("/api/v1/orders/{$orderId}/status", ['status' => $status])->assertOk();
    }

    $order = Order::findOrFail($orderId);
    expect((float) $order->total)->toBe(0.0);

    $invoice = $this->createInvoice($orderId, ['due_date' => today()->subDay()->toDateString()]);

    expect($invoice->payment_status)->toBe('paid')
        ->and($invoice->due_status)->toBe('overdue')
        ->and($invoice->status)->toBe('paid')
        ->and($invoice->remainingAmount())->toBe(0.0)
        ->and($invoice->isSettled())->toBeTrue();

    // No payment is required, and none should be possible.
    $this->postJson('/api/v1/payments', [
        'invoice_id' => $invoice->id,
        'amount' => 0.01,
        'method' => 'cash',
    ])->assertStatus(422)->assertJsonValidationErrors('amount');

    // The nightly job must leave a zero-total invoice alone.
    $this->artisan('invoices:mark-overdue')->assertSuccessful();
    expect($invoice->fresh()->status)->toBe('paid');
});

it('keeps normal positive totals behaving exactly as before', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]);
    $total = (float) $invoice->total;

    expect($total)->toBeGreaterThan(0.0)
        ->and($invoice->payment_status)->toBe('unpaid')
        ->and($invoice->remainingAmount())->toBe($total);

    $this->payInvoice($invoice, $total / 2);
    expect($invoice->fresh()->payment_status)->toBe('partially_paid');

    $this->payInvoice($invoice, $total / 2);
    $invoice->refresh();
    expect($invoice->payment_status)->toBe('paid')
        ->and($invoice->status)->toBe('paid')
        ->and($invoice->remainingAmount())->toBe(0.0);
});

it('exposes payment and due state on the invoice API response', function (): void {
    $this->actingAsEmployee();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);

    $this->getJson("/api/v1/invoices/{$invoice->id}")
        ->assertOk()
        ->assertJsonPath('payment_status', 'unpaid')
        ->assertJsonPath('due_status', 'current')
        // Backward-compatible single-value status is still present.
        ->assertJsonPath('status', 'pending');

    $this->getJson('/api/v1/invoices?payment_status=unpaid')->assertOk()->assertJsonCount(1, 'data');
    $this->getJson('/api/v1/invoices?due_status=current')->assertOk()->assertJsonCount(1, 'data');
});

it('exposes the invoice state columns to the dashboard', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->subDay()->toDateString()]);
    $this->payInvoice($invoice, 100);

    $this->getJson('/api/v1/dashboard')
        ->assertOk()
        ->assertJsonPath('kpis.paid_invoices', 0)
        ->assertJsonPath('kpis.pending_invoices', 1)
        ->assertJsonPath('kpis.overdue_invoices', 1);
});

it('counts a zero total invoice as paid on the dashboard', function (): void {
    $this->actingAsAdministrator();

    $product = Product::factory()->create(['selling_price' => 100]);
    $orderId = $this->postJson('/api/v1/orders', [
        'customer_id' => Customer::factory()->create()->id,
        'items' => [['product_id' => $product->id, 'quantity' => 1, 'discount' => 100]],
    ])->assertCreated()->json('id');

    foreach (['confirmed', 'processing', 'completed'] as $status) {
        $this->patchJson("/api/v1/orders/{$orderId}/status", ['status' => $status])->assertOk();
    }

    $this->createInvoice($orderId, ['due_date' => today()->subDay()->toDateString()]);

    $this->getJson('/api/v1/dashboard')
        ->assertOk()
        ->assertJsonPath('kpis.paid_invoices', 1)
        ->assertJsonPath('kpis.pending_invoices', 0)
        ->assertJsonPath('kpis.overdue_invoices', 1);
});