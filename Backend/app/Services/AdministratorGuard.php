<?php

namespace App\Services;

use App\Models\User;

/**
 * Protects the invariant: at least one active administrator must always remain.
 *
 * The active administrators are locked `FOR UPDATE` before being counted, so two
 * concurrent demotions serialise on the same row set: the second waits for the
 * first to commit, then re-reads the already-updated count instead of deciding
 * from a stale snapshot.
 *
 * Callers must already hold a transaction; the lock is only meaningful inside one.
 */
class AdministratorGuard
{
    public function assertNotLastAdministrator(): void
    {
        $activeAdministrators = User::query()
            ->where('role', 'administrator')
            ->where('is_active', true)
            ->lockForUpdate()
            ->get(['id']);

        abort_if(
            $activeAdministrators->count() <= 1,
            409,
            'At least one active administrator must remain.'
        );
    }

    /**
     * True when the change would remove an active administrator's privileges.
     */
    public function removesAdministrator(User $target, array $changes): bool
    {
        if ($target->role !== 'administrator') {
            return false;
        }

        $demoted = array_key_exists('role', $changes) && $changes['role'] !== 'administrator';
        $disabled = array_key_exists('is_active', $changes)
            && ! filter_var($changes['is_active'], FILTER_VALIDATE_BOOLEAN);

        return $demoted || $disabled;
    }
}