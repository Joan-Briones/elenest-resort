<?php

declare(strict_types=1);

/**
 * Send OTP via iProg SMS using pure PHP (works on InfinityFree / shared hosting).
 * No Python required.
 */

require __DIR__ . '/_lib/config.php';
require __DIR__ . '/_lib/http_json.php';
require __DIR__ . '/_lib/phone.php';
require __DIR__ . '/_lib/iprog.php';

$body = elenest_require_post_json();
$config = elenest_load_config();
$apiToken = elenest_iprog_token_from_config($config);

if (!elenest_iprog_is_configured($apiToken)) {
    elenest_json_respond(500, [
        'ok' => false,
        'message' => 'iProg SMS is not configured. Upload api/config.local.json with your iprog_sms_api_token.',
    ]);
}

$phoneNumber = elenest_normalize_philippine_phone((string) ($body['phone_number'] ?? ''));
if ($phoneNumber === null || !elenest_is_valid_philippine_phone($phoneNumber)) {
    elenest_json_respond(400, [
        'ok' => false,
        'message' => 'Invalid phone number. Use Philippine mobile format: 09XXXXXXXXX.',
    ]);
}

$network = elenest_iprog_detect_network($apiToken, $phoneNumber);
if (!empty($network['ok']) && empty($network['supported'])) {
    elenest_json_respond(422, [
        'ok' => false,
        'message' =>
            'SMS cannot be delivered to '
            . (string) ($network['network'] ?? '')
            . ' numbers with iProg default sender. Use Globe, TM, DITO, or GOMO,'
            . ' or check iprogsms.com dashboard if testing.',
        'network' => $network['network'] ?? null,
        'is_smart_tnt' => !empty($network['is_smart_tnt']),
    ]);
}

$networkLabel = !empty($network['ok'])
    ? ((string) ($network['network'] ?? 'Unknown') ?: 'Unknown')
    : 'Unknown';

$result = elenest_iprog_send_otp($apiToken, $phoneNumber);
if (empty($result['ok'])) {
    elenest_json_respond(502, [
        'ok' => false,
        'message' => (string) ($result['message'] ?? 'Could not send OTP. Check iProg credits and phone network.'),
    ]);
}

elenest_json_respond(200, [
    'ok' => true,
    'message' =>
        'Verification code sent to your phone. If you use Smart/TNT and did not'
        . ' receive it, that network is not supported — try Globe/TM/DITO/GOMO.',
    'phone_number' => $phoneNumber,
    'network' => $networkLabel,
]);
