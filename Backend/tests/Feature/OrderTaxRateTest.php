<?php

use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * The tax rate must never be taken on trust from the client. It is a financial
 * input, so the server owns it: a client may only select from the configured
 * list in the `finance.tax_rates` system setting.
 */

/** Post an order line with an arbitrary tax_rate, bypassing the trait's payload builder. */
function orderWithTaxRate(mixed $taxRate): Illuminate\Testing\TestResponse
{
    $product = Product::factory()->create(['selling_price' => 1000]);

    return test()->postJson('/api/v1/orders', [
        'customer_id' => Customer::factory()->create()->id,
        'items' => [['product_id' => $product->id, 'quantity' => 1, 'tax_rate' => $taxRate]],
    ]);
}

it('allows a configured tax rate', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    $response = $this->postJson('/api/v1/orders', [
        'customer_id' => Customer::factory()->create()->id,
        'items' => [['product_id' => Product::factory()->create(['selling_price' => 1000])->id, 'quantity' => 2, 'tax_rate' => 19]],
    ])->assertCreated();

    $order = Order::findOrFail($response->json('id'));
    expect((float) $order->subtotal)->toBe(2000.0)
        ->and((float) $order->tax)->toBe(380.0)
        ->and((float) $order->total)->toBe(2380.0);
});

it('applies the first configured rate when the client omits one', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([7, 19]);

    ['order_id' => $orderId] = $this->createOrder();

    expect((float) Order::findOrFail($orderId)->tax)->toBe(70.0);
});

it('rejects a tax rate the server has not configured', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    orderWithTaxRate(0)->assertStatus(422)->assertJsonValidationErrors('items');
});

it('rejects an inflated tax rate of 100', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    orderWithTaxRate(100)->assertStatus(422)->assertJsonValidationErrors('items');
});

it('rejects a negative tax rate', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    orderWithTaxRate(-5)->assertStatus(422)->assertJsonValidationErrors('items');
});

it('rejects an absurdly large tax rate', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    orderWithTaxRate(100000)->assertStatus(422)->assertJsonValidationErrors('items');
});

it('rejects a non numeric tax rate', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    // Rejected by the numeric rule before the configured-rate check is reached.
    orderWithTaxRate('nineteen')->assertStatus(422)->assertJsonValidationErrors('items.0.tax_rate');
});

it('defaults to zero tax and ignores any client value when nothing is configured', function (): void {
    $this->actingAsEmployee();
    // Deliberately no finance.tax_rates setting.

    orderWithTaxRate(50)->assertStatus(422)->assertJsonValidationErrors('items');

    // With no rate supplied at all, the order is created at zero tax.
    ['order_id' => $orderId] = $this->createOrder();
    expect((float) Order::findOrFail($orderId)->tax)->toBe(0.0);
});

it('accepts any configured rate, not just the default', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([7, 19]);

    orderWithTaxRate(7)->assertCreated();
});

it('persists the applied rate on the order item', function (): void {
    $this->actingAsEmployee();
    $this->configureTaxRates([19]);

    ['order_id' => $orderId] = $this->createOrder();

    $item = OrderItem::where('order_id', $orderId)->firstOrFail();
    expect((float) $item->tax_rate)->toBe(19.0)
        ->and((float) $item->line_total)->toBe(1190.0);
});