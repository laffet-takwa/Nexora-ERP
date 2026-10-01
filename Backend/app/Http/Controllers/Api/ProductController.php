<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\Product;
use App\Services\AuditLogger;
use App\Services\BusinessNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductController extends Controller
{
    public function index(Request $request)
    {
        $query = Product::with('category');
        if ($search = $request->query('search')) {
            $query->where(fn ($builder) => $builder->where('name', 'like', "%{$search}%")->orWhere('sku', 'like', "%{$search}%"));
        }
        if ($request->filled('category_id')) {
            $query->where('category_id', $request->integer('category_id'));
        }
        if ($request->query('stock_status') === 'low') {
            $query->whereColumn('stock_quantity', '<=', 'minimum_stock_level');
        } elseif ($request->query('stock_status') === 'available') {
            $query->where('stock_quantity', '>', 0);
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        $sort = $request->query('sort', 'name');
        abort_unless(in_array($sort, ['name', 'sku', 'selling_price', 'stock_quantity', 'created_at'], true), 422, 'Invalid sort field.');

        return $query->orderBy($sort, $request->query('direction') === 'desc' ? 'desc' : 'asc')
            ->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function store(Request $request, AuditLogger $audit, BusinessNotifier $notifier)
    {
        $data = $request->validate($this->rules());
        $initialStock = $data['stock_quantity'] ?? 0;
        unset($data['stock_quantity']);

        $product = DB::transaction(function () use ($data, $initialStock, $request): Product {
            $product = Product::create([...$data, 'stock_quantity' => $initialStock]);
            if ($initialStock > 0) {
                InventoryMovement::create([
                    'product_id' => $product->id,
                    'user_id' => $request->user()->id,
                    'type' => 'in',
                    'quantity' => $initialStock,
                    'quantity_after' => $initialStock,
                    'reason' => 'Initial stock',
                ]);
            }

            return $product;
        });
        $audit->record($request, 'created', 'product', $product->id);
        if ($product->stock_quantity <= $product->minimum_stock_level) {
            $notifier->notifyAdministrators('low_stock', 'Product '.$product->name.' is low in stock.', ['product_id' => $product->id]);
        }

        return response()->json($product->load('category'), 201);
    }

    public function show(Product $product)
    {
        return $product->load(['category', 'inventoryMovements' => fn ($query) => $query->latest()->limit(20)]);
    }

    public function update(Request $request, Product $product, AuditLogger $audit)
    {
        $product->update($request->validate($this->rules(true, $product)));
        $audit->record($request, 'updated', 'product', $product->id);

        return response()->json($product->fresh()->load('category'));
    }

    public function destroy(Request $request, Product $product, AuditLogger $audit)
    {
        abort_if($product->inventoryMovements()->exists() || $product->orderItems()->exists(), 409, 'Products referenced by stock history or orders cannot be deleted.');
        $audit->record($request, 'deleted', 'product', $product->id);
        $product->delete();

        return response()->noContent();
    }

    private function rules(bool $partial = false, ?Product $product = null): array
    {
        $required = $partial ? 'sometimes|required' : 'required';

        return [
            'name' => [$required, 'string', 'max:255'],
            'sku' => [$required, 'string', 'max:100', 'unique:products,sku'.($product ? ','.$product->id : '')],
            'description' => ['nullable', 'string'],
            'category_id' => ['nullable', 'integer', 'exists:categories,id'],
            'cost_price' => ['sometimes', 'numeric', 'min:0'],
            'selling_price' => [$required, 'numeric', 'gt:0'],
            'stock_quantity' => $partial ? ['prohibited'] : ['sometimes', 'integer', 'min:0'],
            'minimum_stock_level' => ['sometimes', 'integer', 'min:0'],
            'status' => ['sometimes', 'in:active,inactive'],
        ];
    }
}