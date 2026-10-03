<?php

use App\Models\User;
use App\Services\AdministratorGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsInvoices;

uses(RefreshDatabase::class, BuildsInvoices::class);

/*
 * Regression tests for the "at least one active administrator" invariant.
 *
 * The guard used to count administrators and then write outside any transaction,
 * so two concurrent demotions could each observe two active administrators and
 * both succeed, leaving none.
 *
 * Reachability note: because an administrator is themselves an active
 * administrator, the self-protection checks in the controller already stop the
 * only single-admin cases. The count guard is defence in depth against a
 * concurrent or indirect removal, so it is exercised directly here.
 */

it('allows demoting another administrator while the caller remains', function (): void {
    $acting = $this->actingAsAdministrator();
    $other = User::factory()->administrator()->create(['email' => 'other.admin@nexora.test']);
    $third = User::factory()->create(['email' => 'third@nexora.test']);

    $this->patchJson("/api/v1/users/{$third->id}", ['role' => 'administrator'])->assertOk();
    expect(User::where('role', 'administrator')->where('is_active', true)->count())->toBe(3);

    $this->patchJson("/api/v1/users/{$third->id}", ['role' => 'employee'])
        ->assertOk()
        ->assertJsonPath('role', 'employee');

    expect(User::where('role', 'administrator')->where('is_active', true)->count())->toBe(2)
        ->and($acting->fresh()->role)->toBe('administrator');
});

it('keeps one administrator when the last other one is demoted', function (): void {
    $this->actingAsAdministrator();
    $other = User::factory()->administrator()->create(['email' => 'other.admin@nexora.test']);

    $this->patchJson("/api/v1/users/{$other->id}", ['role' => 'employee'])->assertOk();

    // The caller is still an administrator, so the invariant holds.
    expect(User::where('role', 'administrator')->where('is_active', true)->count())->toBe(1);
});

it('stops an administrator from demoting themselves', function (): void {
    $acting = $this->actingAsAdministrator();

    $this->patchJson("/api/v1/users/{$acting->id}", ['role' => 'employee'])
        ->assertStatus(422)
        ->assertJsonPath('message', 'You cannot disable or demote your own account.');

    expect($acting->fresh()->role)->toBe('administrator');
});

it('stops an administrator from disabling themselves', function (): void {
    $acting = $this->actingAsAdministrator();

    $this->patchJson("/api/v1/users/{$acting->id}", ['is_active' => false])->assertStatus(422);

    expect((bool) $acting->fresh()->is_active)->toBeTrue();
});

it('stops an administrator from deleting themselves', function (): void {
    $acting = $this->actingAsAdministrator();

    $this->deleteJson("/api/v1/users/{$acting->id}")->assertStatus(422);

    expect(User::whereKey($acting->id)->exists())->toBeTrue();
});

it('never leaves the database with zero active administrators', function (): void {
    $this->actingAsAdministrator();
    $second = User::factory()->administrator()->create(['email' => 'second.admin@nexora.test']);
    $third = User::factory()->administrator()->create(['email' => 'third.admin@nexora.test']);

    // Drain every other administrator through every available mutation.
    $this->patchJson("/api/v1/users/{$second->id}", ['role' => 'employee'])->assertOk();
    $this->patchJson("/api/v1/users/{$third->id}", ['is_active' => false])->assertOk();
    $this->deleteJson("/api/v1/users/{$third->id}")->assertNoContent();

    expect(User::where('role', 'administrator')->where('is_active', true)->count())->toBe(1);
});

it('counts only active administrators', function (): void {
    // A disabled administrator must not satisfy the invariant.
    User::factory()->administrator()->disabled()->create(['email' => 'disabled.admin@nexora.test']);
    $enabled = User::factory()->administrator()->create(['email' => 'enabled.admin@nexora.test']);

    $this->actingAsAdministrator();
    expect(User::where('role', 'administrator')->where('is_active', true)->count())->toBe(2);

    $this->patchJson("/api/v1/users/{$enabled->id}", ['role' => 'employee'])->assertOk();

    expect(User::where('role', 'administrator')->where('is_active', true)->count())->toBe(1);
});

it('rejects the removal of the only active administrator', function (): void {
    $guard = app(AdministratorGuard::class);
    User::factory()->administrator()->create();

    expect(fn () => $guard->assertNotLastAdministrator())
        ->toThrow(HttpException::class, 'At least one active administrator must remain.');
});

it('allows the removal when more than one active administrator exists', function (): void {
    $guard = app(AdministratorGuard::class);
    User::factory()->administrator()->create();
    User::factory()->administrator()->create();

    $guard->assertNotLastAdministrator();
})->throwsNoExceptions();

it('locks the administrator rows while enforcing the invariant', function (): void {
    $guard = app(AdministratorGuard::class);
    User::factory()->administrator()->create();
    User::factory()->administrator()->create();

    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    DB::transaction(function () use ($guard): void {
        $guard->assertNotLastAdministrator();
    });

    $locking = collect($queries)->first(
        fn (string $sql): bool => str_contains(strtolower($sql), 'from "users"') || str_contains(strtolower($sql), 'from `users`')
    );

    expect($locking)->not->toBeNull();

    if (DB::connection()->getDriverName() === 'sqlite') {
        // SQLite has no row locking; the query shape is still asserted above.
        expect(str_contains(strtolower((string) $locking), 'for update'))->toBeFalse();
    } else {
        expect(str_contains(strtolower((string) $locking), 'for update'))->toBeTrue();
    }
});

it('detects every change that strips administrator privileges', function (): void {
    $guard = app(AdministratorGuard::class);
    $administrator = User::factory()->administrator()->create();
    $employee = User::factory()->create();

    expect($guard->removesAdministrator($administrator, ['role' => 'employee']))->toBeTrue()
        ->and($guard->removesAdministrator($administrator, ['is_active' => false]))->toBeTrue()
        ->and($guard->removesAdministrator($administrator, ['is_active' => true]))->toBeFalse()
        ->and($guard->removesAdministrator($administrator, ['role' => 'administrator']))->toBeFalse()
        ->and($guard->removesAdministrator($administrator, ['name' => 'Renamed']))->toBeFalse()
        ->and($guard->removesAdministrator($employee, ['role' => 'employee']))->toBeFalse();
});

it('revokes existing sessions when an administrator is disabled', function (): void {
    $this->actingAsAdministrator();
    $other = User::factory()->administrator()->create(['email' => 'other.admin@nexora.test']);
    $other->createToken('test')->accessToken;

    $this->patchJson("/api/v1/users/{$other->id}", ['is_active' => false])->assertOk();

    expect($other->fresh()->tokens()->count())->toBe(0);
});