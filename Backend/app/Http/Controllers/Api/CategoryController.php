<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    public function index()
    {
        return Category::withCount('products')->orderBy('name')->paginate(50);
    }

    public function store(Request $request, AuditLogger $audit)
    {
        $category = Category::create($request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:categories,name'],
            'description' => ['nullable', 'string'],
        ]));
        $audit->record($request, 'created', 'category', $category->id);

        return response()->json($category, 201);
    }

    public function show(Category $category)
    {
        return $category->load(['products' => fn ($query) => $query->orderBy('name')]);
    }

    public function update(Request $request, Category $category, AuditLogger $audit)
    {
        $category->update($request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255', 'unique:categories,name,'.$category->id],
            'description' => ['nullable', 'string'],
        ]));
        $audit->record($request, 'updated', 'category', $category->id);

        return response()->json($category->fresh());
    }

    public function destroy(Request $request, Category $category, AuditLogger $audit)
    {
        abort_if($category->products()->exists(), 409, 'Reassign or remove this category’s products before deleting it.');
        $audit->record($request, 'deleted', 'category', $category->id);
        $category->delete();

        return response()->noContent();
    }
}