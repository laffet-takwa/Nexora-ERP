<?php

use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SystemSettingController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:5,1');
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
    Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:3,1');
    Route::post('/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:5,1');

    Route::middleware(['auth:sanctum', 'active'])->group(function (): void {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/user', [AuthController::class, 'me']);
        Route::put('/profile', [AuthController::class, 'updateProfile']);
        Route::put('/profile/password', [AuthController::class, 'changePassword']);

        Route::get('/dashboard', DashboardController::class);
        Route::get('/reports/sales', [ReportController::class, 'sales']);
        Route::get('/reports/products', [ReportController::class, 'products'])->middleware('role:administrator');
        Route::get('/reports/customers', [ReportController::class, 'customers'])->middleware('role:administrator');
        Route::get('/reports/finance', [ReportController::class, 'finance'])->middleware('role:administrator');

        Route::apiResource('customers', CustomerController::class)->except(['destroy']);
        Route::delete('/customers/{customer}', [CustomerController::class, 'destroy'])->middleware('role:administrator');

        Route::get('/categories', [CategoryController::class, 'index']);
        Route::get('/categories/{category}', [CategoryController::class, 'show']);
        Route::post('/categories', [CategoryController::class, 'store'])->middleware('role:administrator');
        Route::put('/categories/{category}', [CategoryController::class, 'update'])->middleware('role:administrator');
        Route::patch('/categories/{category}', [CategoryController::class, 'update'])->middleware('role:administrator');
        Route::delete('/categories/{category}', [CategoryController::class, 'destroy'])->middleware('role:administrator');

        Route::apiResource('products', ProductController::class)->except(['destroy']);
        Route::delete('/products/{product}', [ProductController::class, 'destroy'])->middleware('role:administrator');

        Route::get('/orders', [OrderController::class, 'index']);
        Route::post('/orders', [OrderController::class, 'store']);
        Route::get('/orders/{order}', [OrderController::class, 'show']);
        Route::patch('/orders/{order}/status', [OrderController::class, 'updateStatus']);

Route::get('/invoices', [InvoiceController::class, 'index']);
    Route::post('/invoices', [InvoiceController::class, 'store']);
    Route::get('/invoices/{invoice}', [InvoiceController::class, 'show']);
    Route::post('/invoices/{invoice}/void', [InvoiceController::class, 'void'])->middleware('role:administrator');

    Route::get('/payments', [PaymentController::class, 'index']);
    Route::post('/payments', [PaymentController::class, 'store']);
    Route::post('/payments/{payment}/refund', [PaymentController::class, 'refund'])->middleware('role:administrator');

        Route::get('/inventory', [InventoryController::class, 'index']);
        Route::get('/inventory/movements', [InventoryController::class, 'movements']);
        Route::post('/inventory/movements', [InventoryController::class, 'storeMovement'])->middleware('role:administrator');

        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead']);
        Route::patch('/notifications/{notificationId}/read', [NotificationController::class, 'markRead']);

        Route::middleware('role:administrator')->group(function (): void {
            Route::apiResource('users', UserController::class);
            Route::get('/audit-logs', [AuditLogController::class, 'index']);
            Route::get('/settings', [SystemSettingController::class, 'index']);
            Route::put('/settings', [SystemSettingController::class, 'update']);

            // Role capabilities are served by the backend so the UI never has to
            // hardcode what each role may do.
            Route::get('/roles', [RoleController::class, 'index']);
            Route::get('/roles/{role}/permissions', [RoleController::class, 'show']);
        });
    });
});