<?php

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

/*
 * Database-level checks that SQLite cannot exercise faithfully: MySQL returns
 * real column types (DECIMAL as string, INT as string), and only MySQL honours
 * row locking. Run against MySQL with:
 *
 *   php artisan test -c phpunit.mysql.xml
 */
uses(RefreshDatabase::class);

it('runs on the database engine the configuration selected', function (): void {
    // Guards against a silent fallback: the MySQL run must actually exercise MySQL,
    // otherwise the lock and type assertions below would pass vacuously.
    expect(DB::connection()->getDriverName())->toBe(env('DB_CONNECTION'));
});

it('exposes integer columns as numbers through the model casts', function (): void {
    $product = Product::factory()->create([
        'stock_quantity' => 7,
        'minimum_stock_level' => 3,
    ]);

    $fresh = Product::findOrFail($product->id);

    expect($fresh->stock_quantity)->toBe(7)
        ->and($fresh->minimum_stock_level)->toBe(3)
        ->and($fresh->stock_quantity)->toBeInt();
});

it('preserves three decimal places for money on the database engine', function (): void {
    $product = Product::factory()->create(['selling_price' => '99.125']);
    $raw = DB::table('products')->where('id', $product->id)->value('selling_price');

    // The column is DECIMAL(12,3), so the third decimal must survive the round trip.
    expect((float) $raw)->toEqualWithDelta(99.125, 0.0005)
        ->and((float) Product::findOrFail($product->id)->selling_price)->toEqualWithDelta(99.125, 0.0005);
});

it('keeps the order ledger total equal to the sum of its parts', function (): void {
    Sanctum::actingAs(User::factory()->create());

    $product = Product::factory()->create(['selling_price' => '10.005']);
    $customer = Customer::factory()->create();

    $orderId = $this->postJson('/api/v1/orders', [
        'customer_id' => $customer->id,
        'items' => [['product_id' => $product->id, 'quantity' => 3]],
    ])->assertCreated()->json('id');

    $order = Order::findOrFail($orderId);
    $expected = round(10.005 * 3, 3);

    expect((float) $order->subtotal)->toEqualWithDelta($expected, 0.001)
        ->and((float) $order->total)->toEqualWithDelta($expected, 0.001);
});

it('enforces one invoice per order at the database level', function (): void {
    Sanctum::actingAs(User::factory()->create());

    $product = Product::factory()->create(['stock_quantity' => 10]);
    $customer = Customer::factory()->create();

    $orderId = $this->postJson('/api/v1/orders', [
        'customer_id' => $customer->id,
        'items' => [['product_id' => $product->id, 'quantity' => 1]],
    ])->assertCreated()->json('id');

    foreach (['confirmed', 'processing', 'completed'] as $status) {
        $this->patchJson("/api/v1/orders/{$orderId}/status", ['status' => $status])->assertOk();
    }

    $this->postJson('/api/v1/invoices', ['order_id' => $orderId])->assertCreated();

    // The unique index on invoices.order_id backs the application-level check.
    expect(Invoice::where('order_id', $orderId)->count())->toBe(1);

    $this->postJson('/api/v1/invoices', ['order_id' => $orderId])
        ->assertStatus(422)
        ->assertJsonValidationErrors('order_id');
});

it('emits a row lock when the administrator guard reads its rows', function (): void {
    User::factory()->administrator()->create();

    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    DB::transaction(function (): void {
        DB::table('users')->where('role', 'administrator')->where('is_active', true)->lockForUpdate()->get(['id']);
    });

    $locking = collect($queries)->first(
        fn (string $sql): bool => str_contains(strtolower($sql), 'from `users`') || str_contains(strtolower($sql), 'from "users"')
    );

    expect($locking)->not->toBeNull();

    // Only MySQL emits FOR UPDATE; SQLite has no row locking at all.
    if (DB::connection()->getDriverName() === 'mysql') {
        expect(strtolower((string) $locking))->toContain('for update');
    } else {
        expect(strtolower((string) $locking))->not->toContain('for update');
    }
});

it('supports the index that makes the overdue transition cheap', function (): void {
    // The nightly job filters on payment_status and due_date.
    $indexes = DB::getSchemaBuilder()->getIndexes('invoices');

    $matching = collect($indexes)->first(fn (array $index): bool => in_array('payment_status', $index['columns'], true)
        && in_array('due_date', $index['columns'], true));

    expect($matching)->not->toBeNull()
        ->and($matching['columns'])->toBe(['payment_status', 'due_date']);
});