<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
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
        $periods = [
            'week' => ['mysql' => "'%x-W%v'", 'sqlite' => "'%Y-W%W'"],
            'month' => ['mysql' => "'%Y-%m'", 'sqlite' => "'%Y-%m'"],
            'day' => ['mysql' => "'%Y-%m-%d'", 'sqlite' => "'%Y-%m-%d'"],
        ];
        $group = $data['group'] ?? 'day';
        $driver = DB::connection()->getDriverName();
        // SQLite has no DATE_FORMAT, and the suite runs there while production is MySQL.
        $format = $periods[$group][$driver] ?? $periods['day'][$driver];

        $query = Order::query()->where('status', 'completed');
        if (! empty($data['from'])) {
            // Filter on the raw datetime column, not a function-wrapped expression:
            // wrapping it in the WHERE clause both defeats the index and, on SQLite,
            // the quoted expression is compared as a literal string.
            $to = $data['to'] ?? $data['from'];
            $query->whereBetween('created_at', [
                Carbon::parse($data['from'])->startOfDay(),
                Carbon::parse($to)->endOfDay(),
            ]);
        }
        $totalRevenue = (float) (clone $query)->sum('total');

        $periodExpression = $driver === 'sqlite'
            ? 'strftime('.$format.', created_at)'
            : 'DATE_FORMAT(created_at, '.$format.')';

        $sales = $query->selectRaw($periodExpression.' as period, COUNT(*) as orders, SUM(total) as revenue')
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
            'low_stock' => Product::with('category:id,name')->whereColumn('stock_quantity', '<=', 'minimum_stock_level')
                ->where('minimum_stock_level', '>', 0)->orderBy('stock_quantity')->get(),
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
            $to = $request->query('to') ?? $request->query('from');
            $payments->whereBetween('payment_date', [$request->query('from').' 00:00:00', $to.' 23:59:59']);
        }

        return response()->json([
            'paid_total' => (float) (clone $payments)->sum('amount'),
            'outstanding_total' => (float) Invoice::query()->whereNotIn('status', ['paid', 'cancelled', 'draft', 'void'])
                ->selectRaw('COALESCE(SUM(total - COALESCE((SELECT SUM(amount) FROM payments WHERE payments.invoice_id = invoices.id), 0)), 0) as balance')
                ->value('balance'),
            'payments' => (clone $payments)->with(['invoice:id,invoice_number', 'customer:id,first_name,last_name'])->latest('payment_date')->paginate(20),
        ]);
    }
}