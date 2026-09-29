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
$title = elenest_plain_line($body['title'] ?? 'Upcoming booking reminder');
$guestName = elenest_plain_line($body['name'] ?? 'Guest');
$checkIn = elenest_plain_line($body['check_in'] ?? '');
$checkOut = elenest_plain_line($body['check_out'] ?? '');
$facility = elenest_plain_line($body['facility'] ?? '');
$paymentStatus = elenest_plain_line($body['payment_status'] ?? '');
$bookingStatus = elenest_plain_line($body['booking_status'] ?? '');
$arrivalStatus = elenest_plain_line($body['arrival_status'] ?? '');
$bookingId = elenest_plain_line($body['booking_id'] ?? '');
$daysBefore = (int) ($body['days_before'] ?? -1);

if ($to === '' || !elenest_is_valid_email($to)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'A valid admin email is required.']);
    exit;
}

if ($guestName === '') {
    $guestName = 'Guest';
}

$fromName = trim((string) ($smtp['from_name'] ?: 'Elenest Resort'));
$subject = $daysBefore === 0
    ? 'Elenest Resort — Check-in Today: ' . $guestName
    : 'Elenest Resort — Upcoming booking reminder: ' . $guestName;

$lines = [
    'Admin reminder from Elenest Resort',
    '',
    $title !== '' ? $title : 'Upcoming confirmed booking',
    '',
    'This is a reminder only. It does not change Payment, Booking, or Arrival status.',
    '',
    'Guest: ' . $guestName,
];

if ($facility !== '') {
    $lines[] = 'Facility: ' . $facility;
}
if ($checkIn !== '') {
    $lines[] = 'Booking / check-in date: ' . $checkIn;
}
if ($checkOut !== '' && $checkOut !== $checkIn) {
    $lines[] = 'Check-out: ' . $checkOut;
}
if ($paymentStatus !== '') {
    $lines[] = 'Payment status: ' . $paymentStatus;
}
if ($bookingStatus !== '') {
    $lines[] = 'Booking status: ' . $bookingStatus;
}
if ($arrivalStatus !== '') {
    $lines[] = 'Arrival status: ' . $arrivalStatus;
}
if ($bookingId !== '') {
    $lines[] = 'Reference: ' . $bookingId;
}

$lines[] = '';
$lines[] = 'Open the Admin Dashboard → Upcoming Bookings to review this reservation.';
$lines[] = '';
$lines[] = '— Elenest Resort';

$result = elenest_smtp_send_mail($smtp, $to, $subject, implode("\r\n", $lines), $smtp['from_email']);
if (!$result['ok']) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'message' => $result['message'] ?: 'Could not send admin reminder email.',
        'booking_id' => $bookingId !== '' ? $bookingId : null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'message' => 'Admin reminder emailed to ' . $to . '.',
    'booking_id' => $bookingId !== '' ? $bookingId : null,
], JSON_UNESCAPED_UNICODE);