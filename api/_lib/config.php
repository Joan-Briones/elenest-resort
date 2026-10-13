<?php

declare(strict_types=1);

function elenest_load_config(): array
{
    $apiDir = dirname(__DIR__);
    $data = [];

    $localJson = $apiDir . DIRECTORY_SEPARATOR . 'config.local.json';
    if (is_file($localJson)) {
        $decoded = json_decode((string) file_get_contents($localJson), true);
        $data = is_array($decoded) ? $decoded : [];
    } else {
        $localPhp = $apiDir . DIRECTORY_SEPARATOR . 'config.local.php';
        if (is_file($localPhp)) {
            $decoded = require $localPhp;
            $data = is_array($decoded) ? $decoded : [];
        } else {
            $exampleJson = $apiDir . DIRECTORY_SEPARATOR . 'config.example.json';
            if (is_file($exampleJson)) {
                $decoded = json_decode((string) file_get_contents($exampleJson), true);
                $data = is_array($decoded) ? $decoded : [];
            }
        }
    }

    return elenest_apply_env_config($data);
}

function elenest_apply_env_config(array $config): array
{
    $keys = [
        'iprog_sms_api_token' => 'IPROG_SMS_API_TOKEN',
        'supabase_url' => 'SUPABASE_URL',
        'supabase_service_role_key' => 'SUPABASE_SERVICE_ROLE_KEY',
        'smtp_host' => 'SMTP_HOST',
        'smtp_port' => 'SMTP_PORT',
        'smtp_username' => 'SMTP_USERNAME',
        'smtp_password' => 'SMTP_PASSWORD',
        'smtp_from_name' => 'SMTP_FROM_NAME',
        'smtp_from_email' => 'SMTP_FROM_EMAIL',
    ];
    $onRender = getenv('RENDER') === 'true';

    foreach ($keys as $key => $envName) {
        $fromEnv = getenv($envName);
        if (!is_string($fromEnv) || trim($fromEnv) === '') {
            continue;
        }
        $current = trim((string) ($config[$key] ?? ''));
        if ($onRender || $current === '' || str_starts_with($current, 'YOUR_')) {
            $config[$key] = $key === 'smtp_port' ? (int) trim($fromEnv) : trim($fromEnv);
        }
    }

    return $config;
}
