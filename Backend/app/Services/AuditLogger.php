<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogger
{
    public function record(Request $request, string $action, string $entity, ?int $entityId = null, array $details = []): void
    {
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'ip_address' => $request->ip(),
            'details' => $details ?: null,
            'created_at' => now(),
        ]);
    }
}