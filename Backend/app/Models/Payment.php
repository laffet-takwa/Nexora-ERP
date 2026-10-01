<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    protected $fillable = [
        'invoice_id', 'customer_id', 'received_by', 'amount', 'method',
        'payment_date', 'reference', 'notes',
    ];

    protected function casts(): array
    {
        return ['amount' => 'decimal:3', 'payment_date' => 'datetime'];
    }

    public function invoice()
    {
        return $this->belongsTo(Invoice::class);
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function receiver()
    {
        return $this->belongsTo(User::class, 'received_by');
    }
}