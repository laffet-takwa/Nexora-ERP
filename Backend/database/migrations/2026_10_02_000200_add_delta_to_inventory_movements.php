<?php

use App\Models\InventoryMovement;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Makes the inventory ledger reconcilable.
 *
 * `quantity` is an unsigned magnitude, so it cannot express direction: a
 * `transfer` records a quantity despite moving nothing, and an `adjustment` of 5
 * is ambiguous between +5 and -5. `delta` carries the signed effect, so
 * `SUM(delta)` per product reconciles against `products.stock_quantity`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_movements', function (Blueprint $table): void {
            $table->integer('delta')->default(0)->after('quantity');
        });

        Schema::table('inventory_movements', function (Blueprint $table): void {
            $table->index(['product_id', 'delta']);
        });

        $this->backfill();
    }

    /**
     * Reconstruct each product's running balance from the `quantity_after` chain.
     *
     * Historic rows predate the column, so direction is inferred from the balance
     * transition between consecutive rows. A product whose very first recorded
     * movement is an adjustment has no earlier baseline to compare against; that
     * single row is left at 0 rather than guessed.
     */
    protected function backfill(): void
    {
        DB::table('inventory_movements')->update(['delta' => 0]);

        DB::table('inventory_movements')
            ->where('type', 'in')
            ->update(['delta' => DB::raw('quantity')]);

        DB::table('inventory_movements')
            ->where('type', 'out')
            ->update(['delta' => DB::raw('-quantity')]);

        InventoryMovement::query()
            ->orderBy('product_id')
            ->orderBy('id')
            ->select(['id', 'product_id', 'type', 'quantity', 'quantity_after'])
            ->chunk(500, function ($movements): void {
                $running = [];

                foreach ($movements as $movement) {
                    $productId = (int) $movement->product_id;

                    if (! array_key_exists($productId, $running)) {
                        $delta = match ($movement->type) {
                            'in' => (int) $movement->quantity,
                            'out' => -(int) $movement->quantity,
                            default => 0,
                        };
                        $running[$productId] = (int) $movement->quantity_after - $delta;

                        if ($movement->type === 'transfer') {
                            $running[$productId] = (int) $movement->quantity_after;
                        }

                        continue;
                    }

                    $delta = (int) $movement->quantity_after - $running[$productId];
                    $running[$productId] = (int) $movement->quantity_after;

                    if ($delta !== 0) {
                        DB::table('inventory_movements')->where('id', $movement->id)->update(['delta' => $delta]);
                    }
                }
            });
    }

    public function down(): void
    {
        Schema::table('inventory_movements', function (Blueprint $table): void {
            $table->dropIndex(['product_id', 'delta']);
            $table->dropColumn('delta');
        });
    }
};