<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $query = User::query()->select(['id', 'name', 'email', 'role', 'is_active', 'created_at']);
        if ($search = $request->query('search')) {
            $query->where(fn ($builder) => $builder->where('name', 'like', "%{$search}%")->orWhere('email', 'like', "%{$search}%"));
        }
        if ($request->filled('role')) {
            $query->where('role', $request->query('role'));
        }

        return $query->latest()->paginate(min(max((int) $request->query('per_page', 15), 1), 100));
    }

    public function store(Request $request, AuditLogger $audit)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::defaults()],
            'role' => ['required', 'in:administrator,employee'],
        ]);
        $user = User::create([...$data, 'is_active' => true]);
        $audit->record($request, 'created', 'user', $user->id, ['role' => $user->role]);

        return response()->json($user->makeHidden(['password', 'remember_token']), 201);
    }

    public function show(User $user)
    {
        return $user->only(['id', 'name', 'email', 'role', 'is_active', 'created_at', 'updated_at']);
    }

    public function update(Request $request, User $user, AuditLogger $audit)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255', 'unique:users,email,'.$user->id],
            'role' => ['sometimes', 'required', 'in:administrator,employee'],
            'is_active' => ['sometimes', 'boolean'],
            'password' => ['sometimes', 'required', 'confirmed', Password::defaults()],
        ]);
        $disablingSelf = array_key_exists('is_active', $data) && ! filter_var($data['is_active'], FILTER_VALIDATE_BOOLEAN);
        abort_if($user->is($request->user()) && ($disablingSelf || ($data['role'] ?? $user->role) !== 'administrator'), 422, 'You cannot disable or demote your own account.');
        $removingAdministrator = $user->role === 'administrator'
            && (($data['role'] ?? 'administrator') !== 'administrator' || $disablingSelf);
        abort_if($user->is_active && $removingAdministrator && User::where('role', 'administrator')->where('is_active', true)->count() <= 1, 409, 'At least one active administrator must remain.');
        $user->update($data);
        if (array_key_exists('is_active', $data) && ! $data['is_active']) {
            $user->tokens()->delete();
        }
        $audit->record($request, 'updated', 'user', $user->id, ['changed_fields' => array_keys($data)]);

        return response()->json($user->fresh()->only(['id', 'name', 'email', 'role', 'is_active', 'created_at', 'updated_at']));
    }

    public function destroy(Request $request, User $user, AuditLogger $audit)
    {
        abort_if($user->is($request->user()), 422, 'You cannot delete your own account.');
        abort_if($user->role === 'administrator' && $user->is_active && User::where('role', 'administrator')->where('is_active', true)->count() <= 1, 409, 'At least one active administrator must remain.');
        $audit->record($request, 'deleted', 'user', $user->id);
        $user->tokens()->delete();
        $user->delete();

        return response()->noContent();
    }
}