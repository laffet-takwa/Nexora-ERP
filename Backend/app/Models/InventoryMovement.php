<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class InventoryMovement extends Model
{
    use HasFactory;

    protected $fillable = [
        'product_id', 'user_id', 'type', 'quantity', 'delta', 'quantity_after',
        'reason', 'from_location', 'to_location',
    ];

    protected function casts(): array
    {
        return [
            'quantity' => 'integer',
            'delta' => 'integer',
            'quantity_after' => 'integer',
        ];
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Signed effect of this movement on `products.stock_quantity`.
     *
     * `quantity` is an unsigned magnitude, so it cannot express direction: a
     * transfer moves nothing, and an adjustment of 5 could be +5 or -5. `delta`
     * is the reconcilable figure and sums to the current stock level.
     */
    public function signedDelta(): int
    {
        return (int) ($this->delta ?? 0);
    }
}