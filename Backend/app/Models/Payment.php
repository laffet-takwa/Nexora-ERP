<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    use HasFactory;

    protected $fillable = [
        'invoice_id', 'customer_id', 'received_by', 'refunds_payment_id', 'amount', 'method',
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

    /** The original payment this entry reverses, when this row is a refund. */
    public function refundsPayment()
    {
        return $this->belongsTo(self::class, 'refunds_payment_id');
    }

    /** Compensating negative entries recorded against this payment. */
    public function refunds()
    {
        return $this->hasMany(self::class, 'refunds_payment_id');
    }

    public function isRefund(): bool
    {
        return $this->refunds_payment_id !== null;
    }

    /** Amount still refundable: the payment less everything already reversed. */
    public function refundableAmount(): float
    {
        return round((float) $this->amount - abs((float) $this->refunds()->sum('amount')), 3);
    }
}