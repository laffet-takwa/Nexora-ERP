<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class BusinessNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly string $event,
        private readonly string $message,
        private readonly array $context = [],
    ) {
    }

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toDatabase(object $notifiable): array
    {
        return ['event' => $this->event, 'message' => $this->message, ...$this->context];
    }
}