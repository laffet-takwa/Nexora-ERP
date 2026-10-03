<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\Product;
use App\Services\AuditLogger;
use App\Services\BusinessNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryController extends Controller
{
    public function index(Request $request)
    {
        $query = Product::with('category');
        if ($search = $request->query('search')) {
            $query->where(fn ($builder) => $builder->where('name', 'like', "%{$search}%")->orWhere('sku', 'like', "%{$search}%"));
        }
        if ($request->boolean('low_stock')) {
            $query->whereColumn('stock_quantity', '<=', 'minimum_stock_level');
        }

        return $query->orderBy('name')->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function movements(Request $request)
    {
        $query = InventoryMovement::with(['product:id,name,sku', 'user:id,name']);
        if ($request->filled('product_id')) {
            $query->where('product_id', $request->integer('product_id'));
        }
        if ($request->filled('type')) {
            $query->where('type', $request->query('type'));
        }

        return $query->latest()->paginate(min(max((int) $request->query('per_page', 20), 1), 100));
    }

    public function storeMovement(Request $request, AuditLogger $audit, BusinessNotifier $notifier)
    {
        $data = $request->validate([
            'product_id' => ['required', 'integer', 'exists:products,id'],
            'type' => ['required', 'in:in,out,adjustment,transfer'],
            'quantity' => ['required', 'integer', 'min:0'],
            'reason' => ['nullable', 'string', 'max:255'],
            'from_location' => ['nullable', 'string', 'max:255'],
            'to_location' => ['nullable', 'string', 'max:255'],
        ]);

        $movement = DB::transaction(function () use ($data, $request): InventoryMovement {
            $product = Product::query()->lockForUpdate()->findOrFail($data['product_id']);
            $oldQuantity = $product->stock_quantity;
            $quantity = $data['quantity'];
            if ($data['type'] !== 'adjustment' && $quantity < 1) {
                throw ValidationException::withMessages(['quantity' => 'Quantity must be greater than zero for this movement type.']);
            }
            $newQuantity = match ($data['type']) {
                'in' => $oldQuantity + $quantity,
                'out' => $oldQuantity - $quantity,
                'adjustment' => $quantity,
                'transfer' => $oldQuantity,
            };
            if ($newQuantity < 0) {
                throw ValidationException::withMessages(['quantity' => 'Stock cannot become negative.']);
            }
            if ($data['type'] === 'adjustment' && $newQuantity === $oldQuantity) {
                throw ValidationException::withMessages(['quantity' => 'The adjusted stock must differ from the current stock.']);
            }
            if ($data['type'] === 'transfer' && (! isset($data['from_location'], $data['to_location']) || $data['from_location'] === $data['to_location'])) {
                throw ValidationException::withMessages(['to_location' => 'A transfer requires two different locations.']);
            }
            // `quantity` stays an unsigned magnitude; `delta` carries the signed
            // effect so the ledger reconciles against products.stock_quantity.
            $recordedQuantity = $data['type'] === 'adjustment' ? abs($newQuantity - $oldQuantity) : $quantity;
            $product->update(['stock_quantity' => $newQuantity]);

            return InventoryMovement::create([
                ...$data,
                'quantity' => $recordedQuantity,
                'delta' => $newQuantity - $oldQuantity,
                'quantity_after' => $newQuantity,
                'user_id' => $request->user()->id,
            ]);
        });
        $audit->record($request, 'stock_moved', 'product', $movement->product_id, ['type' => $movement->type, 'quantity' => $movement->quantity, 'delta' => $movement->delta]);
        $product = $movement->product;
        if ($product->minimum_stock_level > 0 && $product->stock_quantity <= $product->minimum_stock_level) {
            $notifier->notifyAdministrators('low_stock', 'Product '.$product->name.' is low in stock.', ['product_id' => $product->id]);
        }

        return response()->json($movement->load(['product', 'user']), 201);
    }
}