<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Refunds are recorded as compensating negative payments rather than by deleting
 * the original row, so the payment ledger stays append-only and auditable.
 *
 * `amount` is `decimal(12,3)` and unsigned, so negative values are already
 * permitted; this migration only adds the link back to the original payment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table): void {
            $table->foreignId('refunds_payment_id')
                ->nullable()
                ->constrained('payments')
                ->nullOnDelete()
                ->after('received_by');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table): void {
            $table->dropForeign(['refunds_payment_id']);
            $table->dropColumn('refunds_payment_id');
        });
    }
};