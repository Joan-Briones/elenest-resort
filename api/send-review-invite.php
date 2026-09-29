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

function elenest_escape_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$to = trim((string) ($body['to'] ?? ''));
$guestName = elenest_plain_line($body['name'] ?? 'Guest');
$facility = elenest_plain_line($body['facility'] ?? '');
$stayLabel = elenest_plain_line($body['stay_label'] ?? '');
$checkIn = elenest_plain_line($body['check_in'] ?? '');
$checkOut = elenest_plain_line($body['check_out'] ?? '');
$bookingId = elenest_plain_line($body['booking_id'] ?? '');
$reviewUrl = trim((string) ($body['review_url'] ?? ''));

if ($to === '' || !elenest_is_valid_email($to)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'A valid customer email is required.']);
    exit;
}

if ($guestName === '') {
    $guestName = 'Guest';
}

if ($reviewUrl === '' || !preg_match('#^https?://#i', $reviewUrl)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'A valid review URL is required.']);
    exit;
}

$fromName = trim((string) ($smtp['from_name'] ?: 'Elenest Resort'));
$subject = 'Thank you for visiting Elenest Resort — share your experience';

$plainLines = [
    'Good day, ' . $guestName . '!',
    '',
    'Thank you for staying with Elenest Resort. We hope you had a wonderful visit.',
    '',
    'We would love to hear about your experience. Your feedback helps us improve and means a lot to our team.',
];

if ($stayLabel !== '' || $facility !== '' || $checkIn !== '') {
    $plainLines[] = '';
    $plainLines[] = 'Your recent stay:';
    if ($stayLabel !== '') {
        $plainLines[] = 'Stay type: ' . $stayLabel;
    }
    if ($facility !== '') {
        $plainLines[] = 'Facility: ' . $facility;
    }
    if ($checkIn !== '') {
        $plainLines[] = 'Check-in: ' . $checkIn;
    }
    if ($checkOut !== '' && $checkOut !== $checkIn) {
        $plainLines[] = 'Check-out: ' . $checkOut;
    }
    if ($bookingId !== '') {
        $plainLines[] = 'Reference: ' . $bookingId;
    }
}

$plainLines[] = '';
$plainLines[] = 'Review Your Activity:';
$plainLines[] = $reviewUrl;
$plainLines[] = '';
$plainLines[] = 'Warm regards,';
$plainLines[] = $fromName;
$plainLines[] = 'Elenest Resort Team';

$safeName = elenest_escape_html($guestName);
$safeUrl = elenest_escape_html($reviewUrl);
$safeFrom = elenest_escape_html($fromName);

$detailHtml = '';
if ($stayLabel !== '' || $facility !== '' || $checkIn !== '') {
    $detailHtml .= '<p style="margin:16px 0 8px;color:#4a5568;font-size:14px;"><strong>Your recent stay</strong></p><ul style="margin:0 0 20px;padding-left:18px;color:#4a5568;font-size:14px;line-height:1.55;">';
    if ($stayLabel !== '') {
        $detailHtml .= '<li>Stay type: ' . elenest_escape_html($stayLabel) . '</li>';
    }
    if ($facility !== '') {
        $detailHtml .= '<li>Facility: ' . elenest_escape_html($facility) . '</li>';
    }
    if ($checkIn !== '') {
        $detailHtml .= '<li>Check-in: ' . elenest_escape_html($checkIn) . '</li>';
    }
    if ($checkOut !== '' && $checkOut !== $checkIn) {
        $detailHtml .= '<li>Check-out: ' . elenest_escape_html($checkOut) . '</li>';
    }
    if ($bookingId !== '') {
        $detailHtml .= '<li>Reference: ' . elenest_escape_html($bookingId) . '</li>';
    }
    $detailHtml .= '</ul>';
}

$html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f7f5f2;font-family:Georgia,serif;">'
    . '<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;padding:32px 28px;border:1px solid #eadfd6;">'
    . '<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#c46b82;">Elenest Resort</p>'
    . '<h1 style="margin:0 0 16px;font-size:24px;color:#2d3748;">Thank you for your visit</h1>'
    . '<p style="margin:0 0 12px;color:#4a5568;font-size:16px;line-height:1.6;">Good day, ' . $safeName . '!</p>'
    . '<p style="margin:0 0 12px;color:#4a5568;font-size:16px;line-height:1.6;">We hope you enjoyed your stay. We would love to hear about your experience — your feedback helps us improve and means a lot to our team.</p>'
    . $detailHtml
    . '<p style="margin:24px 0;text-align:center;">'
    . '<a href="' . $safeUrl . '" style="display:inline-block;padding:14px 28px;background:#c46b82;color:#ffffff;text-decoration:none;border-radius:999px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;">Review Your Activity</a>'
    . '</p>'
    . '<p style="margin:24px 0 0;color:#4a5568;font-size:15px;line-height:1.6;">Warm regards,<br>' . $safeFrom . '<br>Elenest Resort Team</p>'
    . '</div></body></html>';

$result = elenest_smtp_send_mail(
    $smtp,
    $to,
    $subject,
    implode("\r\n", $plainLines),
    $smtp['from_email'],
    $html
);

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
    'message' => 'Review invitation emailed to ' . $to . '.',
    'booking_id' => $bookingId !== '' ? $bookingId : null,
], JSON_UNESCAPED_UNICODE);
