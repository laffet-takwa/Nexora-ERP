<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Separates invoice payment progress from calendar lateness.
 *
 * A single `status` column previously encoded both facts, so a 90% paid invoice
 * past its due date became indistinguishable from a wholly unpaid one, and the
 * nightly job could overwrite a settled `paid` invoice with `overdue`.
 *
 * `payment_status` and `due_status` become the source of truth. `status` is
 * retained and re-derived so existing database filters and API consumers keep
 * working unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table): void {
            $table->string('payment_status', 20)->default('unpaid')->after('status');
            $table->string('due_status', 20)->default('current')->after('payment_status');
            $table->timestamp('voided_at')->nullable()->after('due_status');
            $table->foreignId('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('void_reason')->nullable();
        });

        // 'void' joins the lifecycle states; the legacy set is otherwise intact.
        Schema::table('invoices', function (Blueprint $table): void {
            $table->enum('status', ['draft', 'pending', 'paid', 'partially_paid', 'overdue', 'cancelled', 'void'])
                ->default('pending')
                ->change();
        });

        $this->backfill();

        Schema::table('invoices', function (Blueprint $table): void {
            $table->index(['payment_status', 'due_date']);
            $table->index('due_status');
        });

        // Supports the row-level lock that makes the last-administrator guard atomic.
        Schema::table('users', function (Blueprint $table): void {
            $table->index(['role', 'is_active']);
        });
    }

    /**
     * Deterministically derive the new columns from the existing payment ledger.
     *
     * Uses only portable SQL so the same backfill runs on MySQL and SQLite.
     */
    protected function backfill(): void
    {
        $paid = '(SELECT COALESCE(SUM(amount), 0) FROM payments WHERE payments.invoice_id = invoices.id)';
        $today = now()->toDateString();

        DB::table('invoices')->update([
            'due_status' => DB::raw(
                "CASE WHEN due_date IS NOT NULL AND due_date < '{$today}' THEN 'overdue' ELSE 'current' END"
            ),
        ]);

        DB::table('invoices')->update([
            'payment_status' => DB::raw(
                "CASE"
                .' WHEN total <= 0 THEN \'paid\''
                ." WHEN {$paid} >= total THEN 'paid'"
                ." WHEN {$paid} > 0 THEN 'partially_paid'"
                ." ELSE 'unpaid' END"
            ),
        ]);

        // Re-derive the legacy column from the same facts, preserving lifecycle states.
        DB::table('invoices')->update([
            'status' => DB::raw(
                "CASE"
                ." WHEN status IN ('draft', 'cancelled', 'void') THEN status"
                .' WHEN total <= 0 THEN \'paid\''
                ." WHEN {$paid} >= total THEN 'paid'"
                ." WHEN due_date IS NOT NULL AND due_date < '{$today}' THEN 'overdue'"
                ." WHEN {$paid} > 0 THEN 'partially_paid'"
                ." ELSE 'pending' END"
            ),
        ]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropIndex(['role', 'is_active']);
        });

        Schema::table('invoices', function (Blueprint $table): void {
            $table->dropIndex(['payment_status', 'due_date']);
            $table->dropIndex('due_status');
            $table->dropForeign(['voided_by']);
            $table->dropColumn(['payment_status', 'due_status', 'voided_at', 'voided_by', 'void_reason']);
        });

        Schema::table('invoices', function (Blueprint $table): void {
            $table->enum('status', ['draft', 'pending', 'paid', 'partially_paid', 'overdue', 'cancelled'])
                ->default('pending')
                ->change();
        });
    }
};