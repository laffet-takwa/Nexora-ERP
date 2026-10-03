<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * The permissions matrix is served by the backend, derived from the `role:`
 * middleware actually applied to each route. The UI must not hardcode it.
 */

it('derives the permission matrix from the registered routes', function (): void {
    $this->actingAsAdministrator();

    $this->getJson('/api/v1/roles')
        ->assertOk()
        ->assertJsonCount(count(\App\Http\Controllers\Api\RoleController::CAPABILITIES), 'data');

    $byKey = collect($this->getJson('/api/v1/roles')->json('data'))->keyBy('key');

    // Core capabilities are reachable by every active authenticated user.
    expect($byKey['dashboard']['permissions'])->toBe(['administrator' => true, 'employee' => true])
        ->and($byKey['customers']['permissions'])->toBe(['administrator' => true, 'employee' => true])
        ->and($byKey['orders']['permissions'])->toBe(['administrator' => true, 'employee' => true]);

    // Administration is administrator only.
    expect($byKey['users']['permissions'])->toBe(['administrator' => true, 'employee' => false])
        ->and($byKey['audit']['permissions'])->toBe(['administrator' => true, 'employee' => false])
        ->and($byKey['settings']['permissions'])->toBe(['administrator' => true, 'employee' => false])
        ->and($byKey['roles']['permissions'])->toBe(['administrator' => true, 'employee' => false]);

    // An employee can manage customers but cannot delete one, so the capability
    // is reachable yet partly restricted.
    expect($byKey['customers']['restricted'])->toBe(['administrator' => false, 'employee' => true])
        ->and($byKey['orders']['restricted'])->toBe(['administrator' => false, 'employee' => false]);
});

it('lists the permissions granted to a single role', function (): void {
    $this->actingAsAdministrator();

    $this->getJson('/api/v1/roles/employee/permissions')
        ->assertOk()
        ->assertJsonPath('role', 'employee');

    $granted = collect($this->getJson('/api/v1/roles/employee/permissions')->json('permissions'))
        ->keyBy('key');

    expect($granted['orders']['granted'])->toBeTrue()
        ->and($granted['orders']['restricted'])->toBeFalse()
        ->and($granted['users']['granted'])->toBeFalse()
        ->and($granted['settings']['granted'])->toBeFalse();
});

it('rejects an unknown role', function (): void {
    $this->actingAsAdministrator();

    $this->getJson('/api/v1/roles/superuser/permissions')->assertNotFound();
});

it('requires an administrator to read the matrix', function (): void {
    $this->actingAsEmployee();

    $this->getJson('/api/v1/roles')->assertForbidden();
    $this->getJson('/api/v1/roles/employee/permissions')->assertForbidden();
});

it('matches the enforced authorization exactly', function (): void {
    $this->actingAsAdministrator();
    $granted = collect($this->getJson('/api/v1/roles/employee/permissions')->json('permissions'))
        ->keyBy('key');

    $this->actingAsEmployee();

    // Whatever the matrix promises for an employee must match reality.
    expect($granted['orders']['granted'])->toBeTrue()
        ->and($granted['users']['granted'])->toBeFalse()
        ->and($granted['settings']['granted'])->toBeFalse();

    $this->getJson('/api/v1/orders')->assertOk();
    $this->getJson('/api/v1/users')->assertForbidden();
    $this->getJson('/api/v1/settings')->assertForbidden();
});