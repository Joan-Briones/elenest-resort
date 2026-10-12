<?php

declare(strict_types=1);

require __DIR__ . '/_lib/config.php';
require __DIR__ . '/_lib/smtp.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'Method not allowed.']);
    exit;
}

$config = elenest_load_config();
$smtp = [
    'host' => (string) ($config['smtp_host'] ?? ''),
    'port' => (int) ($config['smtp_port'] ?? 465),
    'username' => (string) ($config['smtp_username'] ?? ''),
    'password' => (string) ($config['smtp_password'] ?? ''),
    'from_name' => (string) ($config['smtp_from_name'] ?? 'Elenest Resort'),
    'from_email' => (string) ($config['smtp_from_email'] ?? ''),
];

if (
    trim($smtp['host']) === ''
    || trim($smtp['username']) === ''
    || trim($smtp['password']) === ''
    || trim($smtp['from_email']) === ''
) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'SMTP is not configured. Edit api/config.local.json.']);
    exit;
}

$raw = file_get_contents('php://input');
$body = [];
if (is_string($raw) && $raw !== '') {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        $body = $decoded;
    }
}

function elenest_plain_line($value): string
{
    $text = trim((string) $value);
    $text = str_replace(["\r", "\n", "\t"], ' ', $text);
    return preg_replace('/\s+/', ' ', $text) ?? $text;
}

$to = trim((string) ($body['to'] ?? ''));
$guestName = elenest_plain_line($body['name'] ?? 'Guest');
$facility = elenest_plain_line($body['facility'] ?? '');
$schedule = elenest_plain_line($body['schedule'] ?? '');
$guests = elenest_plain_line($body['guests'] ?? '');
$amount = elenest_plain_line($body['amount'] ?? '');
$deadline = elenest_plain_line($body['deadline'] ?? '');
$instructions = elenest_plain_line($body['instructions'] ?? '');
$bookingId = elenest_plain_line($body['booking_id'] ?? '');
$methods = is_array($body['methods'] ?? null) ? $body['methods'] : [];

if ($to === '' || !elenest_is_valid_email($to)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'A valid customer email is required.']);
    exit;
}

if ($guestName === '') {
    $guestName = 'Guest';
}

$fromName = trim((string) ($smtp['from_name'] ?: 'Elenest Resort'));
$subject = 'Your Elenest Resort booking is confirmed — payment is now open';

$lines = [
    'Good day, ' . $guestName . '!',
    '',
    'Your booking details have been confirmed. You can now complete the online payment.',
    '',
    'Confirmed booking details:',
];

if ($facility !== '') {
    $lines[] = 'Facility: ' . $facility;
}
if ($schedule !== '') {
    $lines[] = 'Date and schedule: ' . $schedule;
}
if ($guests !== '') {
    $lines[] = 'Guests: ' . $guests;
}
if ($amount !== '') {
    $lines[] = 'Total amount due: ' . $amount;
}
if ($bookingId !== '') {
    $lines[] = 'Reference: ' . $bookingId;
}

$lines[] = '';
$lines[] = 'Payment methods:';
if (!$methods) {
    $lines[] = 'Payment methods will appear on your booking page.';
} else {
    foreach ($methods as $method) {
        if (!is_array($method)) {
            continue;
        }
        $provider = elenest_plain_line($method['provider'] ?? 'Payment');
        $accountName = elenest_plain_line($method['accountName'] ?? '');
        $accountNumber = elenest_plain_line($method['accountNumber'] ?? '');
        $methodLine = $provider;
        if ($accountName !== '') {
            $methodLine .= ' — ' . $accountName;
        }
        if ($accountNumber !== '') {
            $methodLine .= ' (' . $accountNumber . ')';
        }
        $lines[] = $methodLine;
        $methodInstructions = elenest_plain_line($method['instructions'] ?? '');
        if ($methodInstructions !== '') {
            $lines[] = '  ' . $methodInstructions;
        }
    }
}

$lines[] = '';
$lines[] = $instructions !== ''
    ? $instructions
    : 'Open your booking, pay the amount due, and upload a photo of your receipt before the deadline. Uploading proof does not mark the booking as paid until an admin verifies it.';
$lines[] = '';
if ($deadline !== '') {
    $lines[] = 'Payment deadline: ' . $deadline . ' (3 hours from the time this booking was confirmed).';
} else {
    $lines[] = 'Complete payment within 3 hours of this confirmation.';
}
$lines[] = 'If payment is not submitted before the deadline, the booking expires and the reserved schedule is released.';
$lines[] = '';
$lines[] = 'Thank you for choosing Elenest Resort.';
$lines[] = '';
$lines[] = 'Warm regards,';
$lines[] = $fromName;
$lines[] = 'Elenest Resort Team';

$result = elenest_smtp_send_mail($smtp, $to, $subject, implode("\r\n", $lines), $smtp['from_email']);
if (!$result['ok']) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'message' => $result['message'] ?: 'Could not send email.',
        'booking_id' => $bookingId !== '' ? $bookingId : null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'message' => 'Payment instructions emailed to ' . $to . '.',
    'booking_id' => $bookingId !== '' ? $bookingId : null,
], JSON_UNESCAPED_UNICODE);
