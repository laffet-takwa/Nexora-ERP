<?php

namespace Database\Factories;

use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    protected $model = Product::class;

    public function definition(): array
    {
        return [
            'name' => fake()->words(2, true),
            'sku' => strtoupper(fake()->unique()->bothify('SKU-####')),
            'cost_price' => 500,
            'selling_price' => 1000,
            'stock_quantity' => 50,
            'minimum_stock_level' => 5,
            'status' => 'active',
        ];
    }

    /** A product with no reorder point, so it can never be flagged as low stock. */
    public function withoutReorderPoint(): static
    {
        return $this->state(fn (): array => ['minimum_stock_level' => 0]);
    }
}