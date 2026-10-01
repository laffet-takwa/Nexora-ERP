<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $email = env('ADMIN_EMAIL');
        $password = env('ADMIN_PASSWORD');
        if (! $email || ! $password) {
            throw new RuntimeException('Set ADMIN_EMAIL and ADMIN_PASSWORD before seeding the administrator.');
        }

        User::updateOrCreate(['email' => $email], [
            'name' => env('ADMIN_NAME', 'Nexora Administrator'),
            'password' => $password,
            'role' => 'administrator',
            'is_active' => true,
        ]);
    }
}