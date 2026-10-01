<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $fillable = [
        'order_number', 'customer_id', 'created_by', 'status',
        'subtotal', 'tax', 'discount', 'total', 'notes',
    ];

    protected function casts(): array
    {
        return ['subtotal' => 'decimal:3', 'tax' => 'decimal:3', 'discount' => 'decimal:3', 'total' => 'decimal:3'];
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function invoice()
    {
        return $this->hasOne(Invoice::class);
    }
}