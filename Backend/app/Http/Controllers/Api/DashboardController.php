<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\InventoryMovement;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function __invoke(Request $request)
    {
        $outstanding = Invoice::query()->whereNotIn('status', ['paid', 'cancelled', 'draft', 'void'])
            ->selectRaw('COALESCE(SUM(total - COALESCE((SELECT SUM(amount) FROM payments WHERE payments.invoice_id = invoices.id), 0)), 0) as balance')
            ->value('balance');

        $data = [
            'kpis' => [
                'total_customers' => Customer::count(),
                'total_products' => Product::count(),
                'total_orders' => Order::count(),
                'total_revenue' => (float) Payment::sum('amount'),
                'pending_invoices' => Invoice::whereIn('payment_status', ['unpaid', 'partially_paid'])->whereNotIn('status', ['cancelled', 'void', 'draft'])->count(),
                'paid_invoices' => Invoice::where('payment_status', 'paid')->count(),
                'overdue_invoices' => Invoice::where('due_status', 'overdue')->whereNotIn('status', ['cancelled', 'void', 'draft'])->count(),
                'outstanding_payments' => (float) $outstanding,
                'low_stock_products' => Product::whereColumn('stock_quantity', '<=', 'minimum_stock_level')
                    ->where('minimum_stock_level', '>', 0)->count(),
            ],
            'sales_over_time' => Order::query()->where('status', 'completed')
                ->where('created_at', '>=', now()->subDays(29)->startOfDay())
                ->selectRaw('DATE(created_at) as date, COUNT(*) as orders, SUM(total) as total')
                ->groupBy('date')->orderBy('date')->get(),
            'revenue_by_month' => $this->revenueByMonth(),
            'top_products' => DB::table('order_items')
                ->join('orders', 'orders.id', '=', 'order_items.order_id')
                ->where('orders.status', 'completed')
                ->select('order_items.product_name as name', DB::raw('SUM(order_items.quantity) as quantity'))
                ->groupBy('order_items.product_name')->orderByDesc('quantity')->limit(5)->get(),
            'recent_orders' => Order::with('customer:id,first_name,last_name')->latest()->limit(5)->get(),
            'recent_payments' => Payment::with(['invoice:id,invoice_number', 'customer:id,first_name,last_name'])->latest('payment_date')->limit(5)->get(),
            'recent_invoices' => Invoice::with('customer:id,first_name,last_name')->latest('invoice_date')->limit(5)->get(),
            'low_stock' => Product::with('category:id,name')->whereColumn('stock_quantity', '<=', 'minimum_stock_level')
                ->where('minimum_stock_level', '>', 0)->orderBy('stock_quantity')->limit(10)->get(),
            'stock_movement_count' => InventoryMovement::whereBetween('created_at', [today()->startOfDay(), today()->endOfDay()])->count(),
        ];

        if ($request->user()->isAdministrator()) {
            $data['recent_activity'] = AuditLog::with('user:id,name')->latest('created_at')->limit(10)->get();
        }

        return response()->json($data);
    }

    /**
     * Twelve months of collected revenue.
     *
     * Months are derived with a driver-aware expression because SQLite has no
     * DATE_FORMAT, and the test suite runs on SQLite while production runs MySQL.
     */
    protected function revenueByMonth()
    {
        $monthExpression = DB::connection()->getDriverName() === 'sqlite'
            ? "strftime('%Y-%m', payment_date)"
            : "DATE_FORMAT(payment_date, '%Y-%m')";

        return Payment::query()->where('payment_date', '>=', now()->subMonths(11)->startOfMonth())
            ->selectRaw("{$monthExpression} as month, SUM(amount) as total")
            ->groupBy('month')->orderBy('month')->get();
    }
}