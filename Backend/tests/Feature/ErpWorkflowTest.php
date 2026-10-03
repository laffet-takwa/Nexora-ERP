<?php

use App\Models\Customer;
use App\Models\InventoryMovement;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

/*
 * NOTE on two fixture changes made while fixing the reported bugs:
 *
 * 1. `is_active` is now set explicitly. It was previously omitted and relied on
 *    the column default, but `Sanctum::actingAs()` authenticates the in-memory
 *    model instance, whose `is_active` attribute was therefore null. The
 *    `active` middleware correctly treats a null flag as disabled, so every
 *    authenticated request 403'd. The intended behaviour - an active employee
 *    can create orders - was already correct; the fixture was not.
 *
 * 2. `finance.tax_rates` is configured before the order is created. Tax is a
 *    financial input and is now server-authoritative: with no configured rate the
 *    only permitted value is 0, so a client-supplied 10% is rejected.
 */

it('completes an order, generates an invoice, records payment, and updates stock', function (): void {
    SystemSetting::updateOrCreate(
        ['key' => 'finance.tax_rates'],
        ['value' => [10], 'group' => 'finance'],
    );

    $employee = User::create([
        'name' => 'Sales Employee',
        'email' => 'employee@nexora.test',
        'password' => 'StrongPassword123!',
        'role' => 'employee',
        'is_active' => true,
    ]);
    Sanctum::actingAs($employee);

    $customer = Customer::create(['first_name' => 'Sarra', 'last_name' => 'Saleh', 'email' => 'sarra@example.test']);
    $product = Product::create([
        'name' => 'Laptop',
        'sku' => 'LAP-001',
        'selling_price' => 1000,
        'cost_price' => 700,
        'stock_quantity' => 5,
        'minimum_stock_level' => 1,
        'status' => 'active',
    ]);

    $orderResponse = $this->postJson('/api/v1/orders', [
        'customer_id' => $customer->id,
        'items' => [['product_id' => $product->id, 'quantity' => 2, 'tax_rate' => 10]],
    ])->assertCreated();
    $orderId = $orderResponse->json('id');

    foreach (['confirmed', 'processing', 'completed'] as $status) {
        $this->patchJson("/api/v1/orders/{$orderId}/status", ['status' => $status])->assertOk();
    }

    expect($product->fresh()->stock_quantity)->toBe(3)
        ->and(InventoryMovement::where('product_id', $product->id)->where('type', 'out')->value('quantity'))->toBe(2);

    $invoiceResponse = $this->postJson('/api/v1/invoices', ['order_id' => $orderId])->assertCreated();
    $invoiceId = $invoiceResponse->json('id');
    $invoice = Invoice::findOrFail($invoiceId);

    $this->postJson('/api/v1/payments', [
        'invoice_id' => $invoiceId,
        'amount' => $invoice->total,
        'method' => 'bank_transfer',
    ])->assertCreated();

    expect($invoice->fresh()->status)->toBe('paid')
        ->and($invoice->fresh()->payment_status)->toBe('paid')
        ->and(Order::findOrFail($orderId)->status)->toBe('completed');
});

it('rejects employees from administrator-only user management', function (): void {
    $employee = User::create([
        'name' => 'Sales Employee',
        'email' => 'employee@nexora.test',
        'password' => 'StrongPassword123!',
        'role' => 'employee',
        'is_active' => true,
    ]);
    Sanctum::actingAs($employee);

    $this->getJson('/api/v1/users')->assertForbidden();
});

it('always registers public accounts as employees', function (): void {
    $this->postJson('/api/v1/register', [
        'name' => 'New User',
        'email' => 'new@nexora.test',
        'password' => 'StrongPassword123!',
        'password_confirmation' => 'StrongPassword123!',
        'role' => 'administrator',
    ])->assertCreated()->assertJsonPath('user.role', 'employee');
});