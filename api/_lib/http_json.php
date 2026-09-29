<?php

declare(strict_types=1);

function elenest_json_cors_headers(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

function elenest_json_respond(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function elenest_json_read_body(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function elenest_require_post_json(): array
{
    elenest_json_cors_headers();

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        elenest_json_respond(405, ['ok' => false, 'message' => 'Method not allowed.']);
    }

    return elenest_json_read_body();
}

function elenest_iprog_token_from_config(array $config): string
{
    return trim((string) ($config['iprog_sms_api_token'] ?? ''));
}

function elenest_iprog_is_configured(string $token): bool
{
    return $token !== '' && $token !== 'YOUR_IPROG_API_TOKEN';
}
