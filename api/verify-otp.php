<?php

declare(strict_types=1);

/**
 * Verify OTP via iProg SMS using pure PHP (works on InfinityFree / shared hosting).
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
$otp = trim((string) ($body['otp'] ?? ''));

if ($phoneNumber === null || !elenest_is_valid_philippine_phone($phoneNumber)) {
    elenest_json_respond(400, [
        'ok' => false,
        'message' => 'Invalid phone number. Use Philippine mobile format: 09XXXXXXXXX.',
    ]);
}

if (!preg_match('/^[0-9]{4,8}$/', $otp)) {
    elenest_json_respond(400, [
        'ok' => false,
        'message' => 'Invalid verification code format.',
    ]);
}

$result = elenest_iprog_verify_otp($apiToken, $phoneNumber, $otp);
if (empty($result['ok'])) {
    elenest_json_respond(401, [
        'ok' => false,
        'message' => (string) ($result['message'] ?? 'Invalid or expired verification code.'),
    ]);
}

elenest_json_respond(200, [
    'ok' => true,
    'message' => 'Phone number verified successfully.',
    'phone_number' => $phoneNumber,
    'is_verified' => true,
]);
