<?php

declare(strict_types=1);

/**
 * Pure PHP iProg SMS client (no Python). Works on shared hosts like InfinityFree.
 */

function elenest_iprog_post(string $url, array $payload): array
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return [
            'ok' => false,
            'http_code' => 0,
            'message' => 'Could not encode iProg request.',
            'raw' => null,
        ];
    }

    $httpCode = 0;
    $body = '';
    $error = '';

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 15,
        ]);
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($response === false) {
            $error = (string) curl_error($ch);
        } else {
            $body = (string) $response;
        }
        curl_close($ch);
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
                'content' => $json,
                'timeout' => 30,
                'ignore_errors' => true,
            ],
        ]);
        $response = @file_get_contents($url, false, $context);
        if ($response === false) {
            $error = 'Could not reach iProg SMS.';
        } else {
            $body = (string) $response;
            if (isset($http_response_header) && is_array($http_response_header)) {
                foreach ($http_response_header as $line) {
                    if (preg_match('/^HTTP\/\S+\s+(\d+)/', $line, $m)) {
                        $httpCode = (int) $m[1];
                        break;
                    }
                }
            }
        }
    }

    if ($body === '' && $error !== '') {
        return [
            'ok' => false,
            'http_code' => 0,
            'message' => $error !== '' ? $error : 'Could not reach iProg SMS.',
            'raw' => null,
        ];
    }

    $data = json_decode($body, true);
    if (!is_array($data)) {
        return [
            'ok' => false,
            'http_code' => $httpCode,
            'message' => 'Invalid response from iProg SMS.',
            'raw' => $body,
        ];
    }

    $status = (string) ($data['status'] ?? '');
    $ok = $httpCode >= 200 && $httpCode < 300 && $status === 'success';

    return [
        'ok' => $ok,
        'http_code' => $httpCode,
        'message' => (string) ($data['message'] ?? ($ok ? 'Success.' : 'Request failed.')),
        'raw' => $data,
    ];
}

function elenest_iprog_send_otp(string $apiToken, string $phoneNumber): array
{
    $international = '63' . substr($phoneNumber, 1);
    $attempts = [
        ['phone_number' => $phoneNumber, 'label' => 'local'],
        ['phone_number' => $international, 'label' => 'international'],
    ];

    $last = null;
    foreach ($attempts as $attempt) {
        $result = elenest_iprog_post('https://www.iprogsms.com/api/v1/otp/send_otp', [
            'api_token' => $apiToken,
            'phone_number' => $attempt['phone_number'],
            'message' => 'Your Elenest Resort code is :otp. Valid 5 minutes.',
            'expires_in_minutes' => 5,
        ]);
        $result['phone_format'] = $attempt['label'];
        $last = $result;
        if ($result['ok']) {
            return $result;
        }
    }

    return $last ?? [
        'ok' => false,
        'http_code' => 0,
        'message' => 'Could not send OTP.',
        'raw' => null,
    ];
}

function elenest_iprog_verify_otp(string $apiToken, string $phoneNumber, string $otp): array
{
    $international = '63' . substr($phoneNumber, 1);
    $attempts = [$phoneNumber, $international];
    $last = null;

    foreach ($attempts as $candidate) {
        $result = elenest_iprog_post('https://www.iprogsms.com/api/v1/otp/verify_otp', [
            'api_token' => $apiToken,
            'phone_number' => $candidate,
            'otp' => $otp,
        ]);
        $last = $result;
        if ($result['ok']) {
            return $result;
        }
    }

    return $last ?? [
        'ok' => false,
        'http_code' => 0,
        'message' => 'OTP verification failed.',
        'raw' => null,
    ];
}

function elenest_iprog_detect_network(string $apiToken, string $phoneNumber): array
{
    $result = elenest_iprog_post('https://www.iprogsms.com/api/v1/phone_numbers/detect', [
        'api_token' => $apiToken,
        'phone_number' => $phoneNumber,
    ]);

    if (!$result['ok'] || !is_array($result['raw'] ?? null)) {
        return [
            'ok' => false,
            'network' => 'Unknown',
            'is_smart_tnt' => false,
            'supported' => true,
            'message' => (string) ($result['message'] ?? 'Could not detect network.'),
        ];
    }

    $data = $result['raw']['data'] ?? [];
    $data = is_array($data) ? $data : [];
    $network = (string) ($data['network'] ?? 'Unknown');
    $networkLower = strtolower($network);
    $isSmartTnt = !empty($data['is_smart_tnt']);
    $invalid = str_contains($networkLower, 'invalid');
    $supported = !$isSmartTnt
        && !$invalid
        && !str_contains($networkLower, 'smart')
        && !str_contains($networkLower, 'tnt');

    return [
        'ok' => true,
        'network' => $network,
        'is_smart_tnt' => $isSmartTnt,
        'supported' => $supported,
        'message' => $supported
            ? 'Network supported for SMS delivery.'
            : 'This mobile network cannot receive iProg SMS with the default sender.',
    ];
}
