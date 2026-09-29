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
$paymentType = strtolower(trim((string) ($body['payment_type'] ?? '')));
$isFull = $paymentType === 'full';
$checkIn = elenest_plain_line($body['check_in'] ?? '');
$checkOut = elenest_plain_line($body['check_out'] ?? '');
$facility = elenest_plain_line($body['facility'] ?? '');
$stayLabel = elenest_plain_line($body['stay_label'] ?? '');
$amount = elenest_plain_line($body['amount'] ?? '');
$bookingId = elenest_plain_line($body['booking_id'] ?? '');

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
$subject = $isFull
    ? 'Your Elenest Resort booking is confirmed'
    : 'Your Elenest Resort payment has been verified';

$lines = [
    'Good day, ' . $guestName . '!',
    '',
    $isFull
        ? 'Great news — Elenest Resort has verified your payment. Your booking is confirmed, fully paid, and your slot is locked.'
        : 'Great news — Elenest Resort has verified your down payment. Your reservation is now approved.',
    '',
    'Booking details:',
];

if ($stayLabel !== '') {
    $lines[] = 'Stay type: ' . $stayLabel;
}
if ($facility !== '') {
    $lines[] = 'Facility: ' . $facility;
}
if ($checkIn !== '') {
    $lines[] = 'Check-in: ' . $checkIn;
}
if ($checkOut !== '' && $checkOut !== $checkIn) {
    $lines[] = 'Check-out: ' . $checkOut;
}
if ($amount !== '') {
    $lines[] = 'Payment: ' . $amount;
}
if ($bookingId !== '') {
    $lines[] = 'Reference: ' . $bookingId;
}

$lines[] = '';
if ($isFull) {
    $lines[] = 'This booking is non-refundable. Please keep this email for your records.';
    $lines[] = 'Payment: Approved · Booking: Confirmed · Arrival: Not Arrived until your check-in date.';
} else {
    $lines[] = 'Payment: Approved · Booking: Confirmed · Arrival: Not Arrived.';
    $lines[] = 'If your stay is today, please arrive within 3 hours of this verification. Future stays remain Not Arrived until your booking date.';
}
$lines[] = '';
$lines[] = 'If you have any questions, you may reply to this email. We are happy to help.';
$lines[] = '';
$lines[] = 'Thank you for choosing Elenest Resort. We look forward to welcoming you.';
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
    'message' => 'Confirmation emailed to ' . $to . '.',
    'booking_id' => $bookingId !== '' ? $bookingId : null,
], JSON_UNESCAPED_UNICODE);
