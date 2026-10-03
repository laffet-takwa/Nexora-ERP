<?php

namespace Tests\Support;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\SystemSetting;
use App\Models\User;

/**
 * Builds the order -> invoice -> payment lifecycle through the public API so
 * regression tests exercise the same code paths the application uses.
 */
trait BuildsInvoices
{
    protected function actingAsEmployee(): User
    {
        $employee = User::factory()->create();
        $this->actingAs($employee);

        return $employee;
    }

    protected function actingAsAdministrator(): User
    {
        $administrator = User::factory()->administrator()->create();
        $this->actingAs($administrator);

        return $administrator;
    }

    /** Tax rates are server-authoritative; tests must opt in explicitly. */
    protected function configureTaxRates(array $rates): void
    {
        SystemSetting::updateOrCreate(
            ['key' => 'finance.tax_rates'],
            ['value' => $rates, 'group' => 'finance'],
        );
    }

    /**
     * Create a confirmed order and return it, ready to be invoiced.
     */
    protected function createOrder(array $attributes = []): array
    {
        $customer = $attributes['customer'] ?? Customer::factory()->create();
        $product = $attributes['product'] ?? Product::factory()->create();

        $items = $attributes['items'] ?? [[
            'product_id' => $product->id,
            'quantity' => $attributes['quantity'] ?? 1,
            'discount' => $attributes['item_discount'] ?? null,
        ]];
        $items = array_map(fn (array $item): array => array_filter(
            $item,
            fn ($value, $key): bool => $value !== null || $key === 'quantity',
            ARRAY_FILTER_USE_BOTH,
        ), $items);

        $payload = ['customer_id' => $customer->id, 'items' => $items];
        if (array_key_exists('order_discount', $attributes) && $attributes['order_discount'] !== null) {
            $payload['discount'] = $attributes['order_discount'];
        }

        $response = $this->postJson('/api/v1/orders', $payload);
        $response->assertCreated();
        $orderId = $response->json('id');

        if (($attributes['complete'] ?? true) === true) {
            foreach (['confirmed', 'processing', 'completed'] as $status) {
                $this->patchJson("/api/v1/orders/{$orderId}/status", ['status' => $status])->assertOk();
            }
        }

        return [
            'order_id' => $orderId,
            'customer' => $customer,
            'product' => $product,
        ];
    }

    protected function createInvoice(int $orderId, array $attributes = []): Invoice
    {
        $dueDate = $attributes['due_date'] ?? null;

        // An invoice dated in the past needs its own date, otherwise the API
        // rejects a due date that precedes the (defaulted) invoice date.
        $invoiceDate = $attributes['invoice_date'] ?? null;
        if ($invoiceDate === null && $dueDate !== null && $dueDate < today()->toDateString()) {
            $invoiceDate = $dueDate;
        }

        $payload = array_filter([
            'order_id' => $orderId,
            'invoice_date' => $invoiceDate,
            'due_date' => $dueDate,
        ], fn ($value): bool => $value !== null);

        $response = $this->postJson('/api/v1/invoices', $payload);
        $response->assertCreated();

        return Invoice::findOrFail($response->json('id'));
    }

    protected function payInvoice(Invoice $invoice, float $amount, array $attributes = []): void
    {
        $this->postJson('/api/v1/payments', array_filter([
            'invoice_id' => $invoice->id,
            'amount' => $amount,
            'method' => $attributes['method'] ?? 'bank_transfer',
            'reference' => $attributes['reference'] ?? null,
        ], fn ($value): bool => $value !== null))->assertCreated();
    }
}