<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function index(Request $request)
    {
        $query = Customer::query()->withCount(['orders', 'invoices']);
        if ($search = $request->query('search')) {
            $query->where(fn ($builder) => $builder
                ->where('first_name', 'like', "%{$search}%")
                ->orWhere('last_name', 'like', "%{$search}%")
                ->orWhere('company', 'like', "%{$search}%")
                ->orWhere('email', 'like', "%{$search}%"));
        }
        if ($city = $request->query('city')) {
            $query->where('city', 'like', "%{$city}%");
        }

        $sort = $request->query('sort', 'created_at');
        $direction = $request->query('direction', 'desc');
        abort_unless(in_array($sort, ['first_name', 'last_name', 'company', 'created_at'], true), 422, 'Invalid sort field.');
        abort_unless(in_array($direction, ['asc', 'desc'], true), 422, 'Invalid sort direction.');

        return $query->orderBy($sort, $direction)->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function store(Request $request, AuditLogger $audit)
    {
        $customer = Customer::create($request->validate($this->rules()));
        $audit->record($request, 'created', 'customer', $customer->id);

        return response()->json($customer, 201);
    }

    public function show(Customer $customer)
    {
        return $customer->load([
            'orders' => fn ($query) => $query->latest()->limit(10),
            'invoices' => fn ($query) => $query->latest()->limit(10),
            'payments' => fn ($query) => $query->latest('payment_date')->limit(10),
        ])->loadSum('payments', 'amount');
    }

    public function update(Request $request, Customer $customer, AuditLogger $audit)
    {
        $customer->update($request->validate($this->rules(true)));
        $audit->record($request, 'updated', 'customer', $customer->id);

        return response()->json($customer->fresh());
    }

    public function destroy(Request $request, Customer $customer, AuditLogger $audit)
    {
        abort_if($customer->orders()->exists() || $customer->invoices()->exists(), 409, 'Customers with orders or invoices cannot be deleted.');
        $audit->record($request, 'deleted', 'customer', $customer->id);
        $customer->delete();

        return response()->noContent();
    }

    private function rules(bool $partial = false): array
    {
        $required = $partial ? 'sometimes|required' : 'required';

        return [
            'first_name' => [$required, 'string', 'max:100'],
            'last_name' => [$required, 'string', 'max:100'],
            'company' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:40'],
            'address' => ['nullable', 'string', 'max:255'],
            'city' => ['nullable', 'string', 'max:100'],
            'country' => ['nullable', 'string', 'size:2'],
            'tax_number' => ['nullable', 'string', 'max:100'],
            'notes' => ['nullable', 'string'],
        ];
    }
}