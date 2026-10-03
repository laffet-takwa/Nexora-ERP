<?php

use App\Models\Customer;
use App\Models\InventoryMovement;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * The ledger must reconcile: `quantity` is an unsigned magnitude and cannot
 * express direction, so `delta` carries the signed effect and its sum per product
 * equals the current stock level.
 */

it('records a positive delta for stock coming in', function (): void {
    $this->actingAsAdministrator();
    $product = Product::factory()->create(['stock_quantity' => 10]);

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id,
        'type' => 'in',
        'quantity' => 5,
    ])->assertCreated();

    $movement = InventoryMovement::latest('id')->firstOrFail();
    expect((int) $movement->quantity)->toBe(5)
        ->and((int) $movement->delta)->toBe(5)
        ->and((int) $movement->quantity_after)->toBe(15)
        ->and($product->fresh()->stock_quantity)->toBe(15);
});

it('records a negative delta for stock going out', function (): void {
    $this->actingAsAdministrator();
    $product = Product::factory()->create(['stock_quantity' => 10]);

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id,
        'type' => 'out',
        'quantity' => 4,
    ])->assertCreated();

    $movement = InventoryMovement::latest('id')->firstOrFail();
    expect((int) $movement->delta)->toBe(-4)
        ->and((int) $movement->quantity_after)->toBe(6);
});

it('distinguishes a negative adjustment from a positive one of the same size', function (): void {
    $this->actingAsAdministrator();

    $up = Product::factory()->create(['stock_quantity' => 10]);
    $down = Product::factory()->create(['stock_quantity' => 10]);

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $up->id, 'type' => 'adjustment', 'quantity' => 15,
    ])->assertCreated();

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $down->id, 'type' => 'adjustment', 'quantity' => 5,
    ])->assertCreated();

    // Both adjustments record a magnitude of 5, but their deltas differ in sign.
    $upMovement = InventoryMovement::where('product_id', $up->id)->latest('id')->firstOrFail();
    $downMovement = InventoryMovement::where('product_id', $down->id)->latest('id')->firstOrFail();

    expect((int) $upMovement->quantity)->toBe(5)
        ->and((int) $downMovement->quantity)->toBe(5)
        ->and((int) $upMovement->delta)->toBe(5)
        ->and((int) $downMovement->delta)->toBe(-5);
});

it('records a zero delta for a transfer', function (): void {
    $this->actingAsAdministrator();
    $product = Product::factory()->create(['stock_quantity' => 10]);

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id,
        'type' => 'transfer',
        'quantity' => 3,
        'from_location' => 'Main warehouse',
        'to_location' => 'Retail floor',
    ])->assertCreated();

    $movement = InventoryMovement::latest('id')->firstOrFail();
    // Stock did not move, so the ledger must record that.
    expect((int) $movement->delta)->toBe(0)
        ->and((int) $movement->quantity_after)->toBe(10)
        ->and($product->fresh()->stock_quantity)->toBe(10);
});

it('reconciles the delta sum against the current stock level', function (): void {
    $this->actingAsAdministrator();
    $product = Product::factory()->create(['stock_quantity' => 0]);

    // Opening stock.
    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id, 'type' => 'in', 'quantity' => 20,
    ])->assertCreated();
    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id, 'type' => 'out', 'quantity' => 7,
    ])->assertCreated();
    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id, 'type' => 'adjustment', 'quantity' => 12,
    ])->assertCreated();
    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id, 'type' => 'transfer', 'quantity' => 4,
        'from_location' => 'A', 'to_location' => 'B',
    ])->assertCreated();

    $expectedStock = 12;
    $deltaSum = (int) InventoryMovement::where('product_id', $product->id)->sum('delta');

    expect($product->fresh()->stock_quantity)->toBe($expectedStock)
        ->and($deltaSum)->toBe($expectedStock);
});

it('reconciles across several products independently', function (): void {
    $this->actingAsAdministrator();
    $first = Product::factory()->create(['stock_quantity' => 0]);
    $second = Product::factory()->create(['stock_quantity' => 0]);

    foreach ([[$first, 30], [$second, 5]] as [$product, $quantity]) {
        $this->postJson('/api/v1/inventory/movements', [
            'product_id' => $product->id, 'type' => 'in', 'quantity' => $quantity,
        ])->assertCreated();
        $this->postJson('/api/v1/inventory/movements', [
            'product_id' => $product->id, 'type' => 'out', 'quantity' => 2,
        ])->assertCreated();
    }

    foreach ([[$first, 28], [$second, 3]] as [$product, $expected]) {
        expect((int) InventoryMovement::where('product_id', $product->id)->sum('delta'))->toBe($expected)
            ->and($product->fresh()->stock_quantity)->toBe($expected);
    }
});

it('records the opening stock of a newly created product as a positive delta', function (): void {
    $this->actingAsEmployee();

    $this->postJson('/api/v1/products', [
        'name' => 'Router',
        'sku' => 'NET-900',
        'selling_price' => 199,
        'cost_price' => 99,
        'stock_quantity' => 12,
        'minimum_stock_level' => 3,
    ])->assertCreated();

    $product = Product::where('sku', 'NET-900')->firstOrFail();
    $movement = InventoryMovement::where('product_id', $product->id)->firstOrFail();

    expect((int) $movement->delta)->toBe(12)
        ->and((int) InventoryMovement::where('product_id', $product->id)->sum('delta'))
        ->toBe($product->stock_quantity);
});

it('records a negative delta when an order is completed', function (): void {
    $this->actingAsEmployee();
    $product = Product::factory()->create(['stock_quantity' => 10, 'selling_price' => 1000]);

    $orderId = $this->postJson('/api/v1/orders', [
        'customer_id' => Customer::factory()->create()->id,
        'items' => [['product_id' => $product->id, 'quantity' => 3]],
    ])->assertCreated()->json('id');

    foreach (['confirmed', 'processing', 'completed'] as $status) {
        $this->patchJson("/api/v1/orders/{$orderId}/status", ['status' => $status])->assertOk();
    }

    $movement = InventoryMovement::where('product_id', $product->id)->where('type', 'out')->firstOrFail();
    expect((int) $movement->delta)->toBe(-3)
        ->and((int) $movement->quantity_after)->toBe(7)
        ->and($product->fresh()->stock_quantity)->toBe(7);
});

it('exposes the delta on the movement history endpoint', function (): void {
    $this->actingAsAdministrator();
    $product = Product::factory()->create(['stock_quantity' => 10]);

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id, 'type' => 'out', 'quantity' => 3,
    ])->assertCreated();

    $this->getJson("/api/v1/inventory/movements?product_id={$product->id}")
        ->assertOk()
        ->assertJsonPath('data.0.delta', -3)
        ->assertJsonPath('data.0.quantity', 3)
        ->assertJsonPath('data.0.quantity_after', 7);
});

it('never alerts on a product that has no reorder point', function (): void {
    Illuminate\Support\Facades\Notification::fake();

    $this->actingAsAdministrator();
    $product = Product::factory()->create(['stock_quantity' => 1, 'minimum_stock_level' => 0]);

    $this->postJson('/api/v1/inventory/movements', [
        'product_id' => $product->id, 'type' => 'out', 'quantity' => 1,
    ])->assertCreated();

    // Stock is 0 and below the 0 threshold, but a zero threshold means "no reorder point".
    $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('kpis.low_stock_products', 0);
    Illuminate\Support\Facades\Notification::assertNothingSent();
});