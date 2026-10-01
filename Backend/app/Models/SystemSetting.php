<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SystemSetting extends Model
{
    protected $fillable = ['key', 'value', 'group', 'updated_by'];

    protected function casts(): array
    {
        return ['value' => 'array'];
    }

    public function updater()
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}