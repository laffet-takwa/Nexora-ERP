<?php

namespace App\Services;

use App\Models\User;
use App\Notifications\BusinessNotification;

class BusinessNotifier
{
    public function notifyAdministrators(string $event, string $message, array $context = []): void
    {
        User::query()->where('role', 'administrator')->where('is_active', true)->each(
            fn (User $user) => $user->notify(new BusinessNotification($event, $message, $context)),
        );
    }
}