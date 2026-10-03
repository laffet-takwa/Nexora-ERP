<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/**
 * Serves the role capability matrix straight from the registered routes.
 *
 * The frontend must not hardcode what a role may do: a permission shown here is
 * derived from the `role:` middleware actually applied to the matching routes,
 * so the matrix cannot drift from the enforced authorization.
 */
class RoleController extends Controller
{
    /** Capability key => [label, uri prefixes it covers]. */
    public const CAPABILITIES = [
        'dashboard' => ['Dashboard', ['api/v1/dashboard', 'api/v1/user', 'api/v1/profile', 'api/v1/logout']],
        'customers' => ['Customers', ['api/v1/customers']],
        'products' => ['Products', ['api/v1/products', 'api/v1/categories']],
        'orders' => ['Orders', ['api/v1/orders']],
        'invoices' => ['Invoices', ['api/v1/invoices']],
        'payments' => ['Payments', ['api/v1/payments']],
        'inventory' => ['Inventory', ['api/v1/inventory']],
        'reports' => ['Reports', ['api/v1/reports']],
        'users' => ['User management', ['api/v1/users']],
        'audit' => ['Audit logs', ['api/v1/audit-logs']],
        'settings' => ['System settings', ['api/v1/settings']],
        'roles' => ['Roles & permissions', ['api/v1/roles']],
    ];

    public const ROLES = ['administrator', 'employee'];

    public function index(Request $request)
    {
        $matrix = [];

        foreach (self::CAPABILITIES as $key => [$label, $prefixes]) {
            $matrix[] = [
                'key' => $key,
                'label' => $label,
                ...$this->permissionsFor($prefixes),
            ];
        }

        return response()->json(['data' => $matrix]);
    }

    public function show(string $role)
    {
        abort_unless(in_array($role, self::ROLES, true), 404);

        return response()->json([
            'role' => $role,
            'permissions' => collect(self::CAPABILITIES)
                ->map(fn ($definition, $key) => [
                    'key' => $key,
                    'label' => $definition[0],
                    'granted' => $this->permissionsFor($definition[1])['permissions'][$role] ?? false,
                    'restricted' => $this->permissionsFor($definition[1])['restricted'][$role] ?? false,
                ])
                ->values(),
        ]);
    }

    /**
     * A capability is `granted` when the role can reach at least one matching route.
     *
     * `restricted` marks capabilities where some actions need more than that, for
     * example an employee can manage customers but not delete one. Both are read
     * from the `role:` middleware actually applied to the routes, so the matrix
     * cannot drift from the enforced authorization.
     */
    protected function permissionsFor(array $prefixes): array
    {
        $routes = collect(Route::getRoutes())->filter(
            fn ($route) => $this->coversAnyPrefix($route->uri(), $prefixes)
        );

        $permissions = [];
        $restricted = [];

        foreach (self::ROLES as $role) {
            $allowed = $routes->filter(fn ($route) => $this->routeAllows($route, $role));

            $permissions[$role] = $allowed->isNotEmpty();
            $restricted[$role] = $allowed->isNotEmpty() && $allowed->count() < $routes->count();
        }

        return ['permissions' => $permissions, 'restricted' => $restricted];
    }

    protected function coversAnyPrefix(string $uri, array $prefixes): bool
    {
        foreach ($prefixes as $prefix) {
            if ($uri === $prefix || str_starts_with($uri, rtrim($prefix, '/').'/')) {
                return true;
            }
        }

        return false;
    }

    protected function routeAllows($route, string $role): bool
    {
        foreach ($route->gatherMiddleware() as $middleware) {
            if (! is_string($middleware) || ! str_starts_with($middleware, 'role:')) {
                continue;
            }

            $required = array_map('trim', explode(',', substr($middleware, strlen('role:'))));

            if (! in_array($role, $required, true)) {
                return false;
            }
        }

        return true;
    }
}