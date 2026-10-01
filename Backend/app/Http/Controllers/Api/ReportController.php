<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    public function sales(Request $request)
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'group' => ['sometimes', 'in:day,week,month'],
        ]);
        $format = match ($data['group'] ?? 'day') {
            'week' => '%x-W%v',
            'month' => '%Y-%m',
            default => '%Y-%m-%d',
        };
        $query = Order::query()->where('status', 'completed');
        if (! empty($data['from'])) {
            $query->whereDate('created_at', '>=', $data['from']);
        }
        if (! empty($data['to'])) {
            $query->whereDate('created_at', '<=', $data['to']);
        }
        $totalRevenue = (float) (clone $query)->sum('total');
        $sales = $query->selectRaw("DATE_FORMAT(created_at, '{$format}') as period, COUNT(*) as orders, SUM(total) as revenue")
            ->groupBy('period')->orderBy('period')->get();

        return response()->json([
            'sales' => $sales,
            'total_revenue' => $totalRevenue,
        ]);
    }

    public function products()
    {
        return response()->json([
            'best_sellers' => DB::table('order_items')->join('orders', 'orders.id', '=', 'order_items.order_id')
                ->where('orders.status', 'completed')
                ->select('order_items.product_name as name', DB::raw('SUM(order_items.quantity) as quantity'), DB::raw('SUM(order_items.line_total) as revenue'))
                ->groupBy('order_items.product_name')->orderByDesc('quantity')->limit(20)->get(),
            'low_stock' => Product::with('category:id,name')->whereColumn('stock_quantity', '<=', 'minimum_stock_level')->orderBy('stock_quantity')->get(),
        ]);
    }

    public function customers()
    {
        return Customer::query()->withSum('payments', 'amount')->orderByDesc('payments_sum_amount')->paginate(20);
    }

    public function finance(Request $request)
    {
        $payments = Payment::query();
        if ($request->filled('from')) {
            $payments->whereDate('payment_date', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $payments->whereDate('payment_date', '<=', $request->query('to'));
        }

        return response()->json([
            'paid_total' => (float) (clone $payments)->sum('amount'),
            'outstanding_total' => (float) Invoice::query()->whereNotIn('status', ['paid', 'cancelled', 'draft'])
                ->selectRaw('COALESCE(SUM(total - COALESCE((SELECT SUM(amount) FROM payments WHERE payments.invoice_id = invoices.id), 0)), 0) as balance')
                ->value('balance'),
            'payments' => (clone $payments)->with(['invoice:id,invoice_number', 'customer:id,first_name,last_name'])->latest('payment_date')->paginate(20),
        ]);
    }
}