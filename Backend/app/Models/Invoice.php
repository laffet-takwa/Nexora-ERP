<?php

namespace App\Models;

use App\Services\InvoiceState;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Invoice extends Model
{
    use HasFactory;

    protected $fillable = [
        'invoice_number', 'order_id', 'customer_id', 'invoice_date', 'due_date',
        'status', 'payment_status', 'due_status', 'voided_at', 'voided_by', 'void_reason',
        'subtotal', 'tax', 'discount', 'total',
    ];

    protected function casts(): array
    {
        return [
            'invoice_date' => 'date',
            'due_date' => 'date',
            'voided_at' => 'datetime',
            'payment_status' => 'string',
            'due_status' => 'string',
            'subtotal' => 'decimal:3',
            'tax' => 'decimal:3',
            'discount' => 'decimal:3',
            'total' => 'decimal:3',
        ];
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function payments()
    {
        return $this->hasMany(Payment::class);
    }

    public function voidedBy()
    {
        return $this->belongsTo(User::class, 'voided_by');
    }

    /** Recompute payment/due state from the ledger; see {@see InvoiceState}. */
    public function syncState(): self
    {
        return InvoiceState::sync($this);
    }

    /** True when nothing further is owed on this invoice. */
    public function isSettled(): bool
    {
        return $this->payment_status === 'paid' || in_array($this->status, InvoiceState::CLOSED_STATES, true);
    }

    /** True when payment is still accepted. */
    public function isOpenForPayment(): bool
    {
        return ! in_array($this->status, InvoiceState::CLOSED_STATES, true);
    }

    public function paidAmount(): float
    {
        return round((float) $this->payments()->sum('amount'), 3);
    }

    public function remainingAmount(): float
    {
        return round((float) $this->total - $this->paidAmount(), 3);
    }

    /** Newest first, matching the invoice_date ordering the lists rely on. */
    public function scopeOverdueCandidates(Builder $query): Builder
    {
        return InvoiceState::overdueScope($query)
            ->whereNotNull('due_date')
            ->where('due_date', '<', today()->toDateString());
    }
}