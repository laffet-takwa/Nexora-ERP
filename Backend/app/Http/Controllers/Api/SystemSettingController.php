<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SystemSettingController extends Controller
{
    public function index(Request $request)
    {
        $query = SystemSetting::query()->orderBy('group')->orderBy('key');
        if ($request->filled('group')) {
            $query->where('group', $request->query('group'));
        }

        return $query->get();
    }

    public function update(Request $request, AuditLogger $audit)
    {
        $data = $request->validate([
            'settings' => ['required', 'array', 'min:1'],
            'settings.*.key' => ['required', 'string', 'max:255'],
            'settings.*.value' => ['present'],
            'settings.*.group' => ['sometimes', 'string', 'max:100'],
        ]);

        $settings = DB::transaction(function () use ($data, $request) {
            return collect($data['settings'])->map(fn (array $setting) => SystemSetting::updateOrCreate(
                ['key' => $setting['key']],
                [
                    'value' => $setting['value'],
                    'group' => $setting['group'] ?? 'general',
                    'updated_by' => $request->user()->id,
                ],
            ));
        });
        $audit->record($request, 'updated', 'system_settings', null, ['keys' => $settings->pluck('key')->all()]);

        return response()->json($settings);
    }
}