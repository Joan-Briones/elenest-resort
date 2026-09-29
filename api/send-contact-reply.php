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

$to = trim((string) ($body['to'] ?? ''));
$guestName = trim((string) ($body['name'] ?? 'Guest'));
$reply = trim((string) ($body['reply'] ?? ''));
$original = trim((string) ($body['original_message'] ?? ''));
$messageId = trim((string) ($body['message_id'] ?? ''));

if ($to === '' || !elenest_is_valid_email($to)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'A valid customer email is required.']);
    exit;
}

if ($reply === '') {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'message' => 'Reply message is required.']);
    exit;
}

if ($guestName === '') {
    $guestName = 'Guest';
}

$fromName = trim((string) ($smtp['from_name'] ?: 'Elenest Resort'));
$subject = 'Re: Your message to Elenest Resort';
$lines = [
    'Good day, ' . $guestName . '!',
    '',
    'Thank you for reaching out to Elenest Resort. We truly appreciate your message and the time you took to contact us.',
    '',
    'Here is our response:',
    '',
    $reply,
    '',
    'If you have any other questions or need further assistance, please feel free to reply to this email. We are always happy to help.',
    '',
    'Thank you once again for choosing Elenest Resort. We look forward to welcoming you soon.',
    '',
    'Warm regards,',
    $fromName,
    'Elenest Resort Team',
];
if ($original !== '') {
    $lines[] = '';
    $lines[] = '---';
    $lines[] = 'Your original message:';
    $lines[] = $original;
}

$result = elenest_smtp_send_mail($smtp, $to, $subject, implode("\r\n", $lines), $smtp['from_email']);
if (!$result['ok']) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'message' => $result['message'] ?: 'Could not send email.',
        'message_id' => $messageId !== '' ? $messageId : null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok' => true,
    'message' => 'Reply emailed to ' . $to . '.',
    'message_id' => $messageId !== '' ? $messageId : null,
], JSON_UNESCAPED_UNICODE);
