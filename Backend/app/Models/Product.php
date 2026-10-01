<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $fillable = [
        'name', 'sku', 'description', 'category_id', 'cost_price',
        'selling_price', 'stock_quantity', 'minimum_stock_level', 'status',
    ];

    protected function casts(): array
    {
        return ['cost_price' => 'decimal:3', 'selling_price' => 'decimal:3'];
    }

    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    public function orderItems()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function inventoryMovements()
    {
        return $this->hasMany(InventoryMovement::class);
    }
}