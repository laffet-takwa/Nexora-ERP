<?php

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * Date filtering was rewritten from whereDate() to range comparisons so the
 * indexes stay usable. These tests pin the boundary behaviour so the change cannot
 * silently start excluding or including records at the edges of a day.
 */

/** Order created at a precise wall-clock time, bypassing the API. */
function orderAt(string $timestamp): Order
{
    $customer = \App\Models\Customer::factory()->create();
    $product = \App\Models\Product::factory()->create(['stock_quantity' => 100]);

    $order = Order::create([
        'order_number' => 'ORD-TEST-'.substr(md5($timestamp), 0, 10),
        'customer_id' => $customer->id,
        'status' => 'completed',
        'subtotal' => 100,
        'tax' => 0,
        'discount' => 0,
        'total' => 100,
    ]);

    // created_at is guarded, so it is written explicitly rather than mass assigned.
    $order->forceFill(['created_at' => $timestamp, 'updated_at' => $timestamp])->save();

    return $order->fresh();
}

it('includes an order created at the first second of the requested day', function (): void {
    $this->actingAsEmployee();
    $day = today()->subDays(3)->toDateString();
    orderAt($day.' 00:00:00');

    $response = $this->getJson("/api/v1/orders?from={$day}&to={$day}")->assertOk();

    expect($response->json('total'))->toBe(1)
        ->and($response->json('data.0.created_at'))->not->toBeNull();
});

it('includes an order created at the last second of the requested day', function (): void {
    $this->actingAsEmployee();
    $day = today()->subDays(2)->toDateString();
    orderAt($day.' 23:59:59');

    $this->getJson("/api/v1/orders?from={$day}&to={$day}")
        ->assertOk()
        ->assertJsonPath('total', 1);
});

it('excludes an order created one second into the next day', function (): void {
    $this->actingAsEmployee();
    $day = today()->subDay()->toDateString();
    orderAt(today()->toDateString().' 00:00:00');

    $this->getJson("/api/v1/orders?from={$day}&to={$day}")
        ->assertOk()
        ->assertJsonPath('total', 0);
});

it('returns the same count for a range as for each day inside it', function (): void {
    $this->actingAsEmployee();
    orderAt(today()->subDays(4)->toDateString().' 12:00:00');
    orderAt(today()->subDays(3)->toDateString().' 00:00:00');
    orderAt(today()->subDays(3)->toDateString().' 23:59:59');
    orderAt(today()->subDays(2)->toDateString().' 08:30:00');

    $from = today()->subDays(4)->toDateString();
    $to = today()->subDays(2)->toDateString();

    $this->getJson("/api/v1/orders?from={$from}&to={$to}")
        ->assertOk()
        ->assertJsonPath('total', 4);
});

it('applies a single-day payment filter at both boundaries', function (): void {
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId);

    Payment::create([
        'invoice_id' => $invoice->id,
        'customer_id' => $invoice->customer_id,
        'received_by' => $this->actingAsAdministrator()->id,
        'amount' => 50,
        'method' => 'cash',
        // A time well inside the day, to prove the range is not truncated.
        'payment_date' => today()->toDateString().' 00:00:00',
    ]);

    $day = today()->toDateString();
    $this->getJson("/api/v1/payments?from={$day}&to={$day}")
        ->assertOk()
        ->assertJsonPath('total', 1);
});

it('groups a daily sales report by calendar day', function (): void {
    $this->actingAsAdministrator();
    orderAt(today()->toDateString().' 00:00:00');
    orderAt(today()->toDateString().' 23:59:59');

    $day = today()->toDateString();
    $response = $this->getJson("/api/v1/reports/sales?from={$day}&to={$day}&group=day")->assertOk();

    $periods = collect($response->json('sales'))->pluck('period');
    expect($periods)->toContain($day)
        ->and((float) $response->json('total_revenue'))->toEqualWithDelta(200.0, 0.001);
});

it('does not flag an invoice as overdue on its due date itself', function (): void {
    Notification::fake();
    $this->actingAsAdministrator();
    ['order_id' => $orderId] = $this->createOrder();
    $invoice = $this->createInvoice($orderId, ['due_date' => today()->addDays(30)->toDateString()]);

    // Due today: still current, not overdue.
    $invoice->update(['due_date' => today()->toDateString()]);
    $invoice->refresh()->syncState();

    expect($invoice->due_status)->toBe('current');

    $this->artisan('invoices:mark-overdue')
        ->expectsOutput('0 invoice(s) marked overdue.')
        ->assertSuccessful();

    expect($invoice->fresh()->status)->toBe('pending');
});