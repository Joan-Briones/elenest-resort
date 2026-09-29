<?php

declare(strict_types=1);

function elenest_is_valid_email(string $value): bool
{
    return (bool) preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $value);
}

/**
 * @param array<string, mixed> $smtp
 * @return array{ok: bool, message: string}
 */
function elenest_smtp_send_mail(array $smtp, string $to, string $subject, string $bodyText, ?string $replyTo = null, ?string $bodyHtml = null): array
{
    $host = trim((string) ($smtp['host'] ?? ''));
    $port = (int) ($smtp['port'] ?? 465);
    $username = trim((string) ($smtp['username'] ?? ''));
    $password = preg_replace('/\s+/', '', (string) ($smtp['password'] ?? '')) ?? '';
    $fromName = trim((string) ($smtp['from_name'] ?? 'Elenest Resort'));
    $fromEmail = trim((string) ($smtp['from_email'] ?? $username));

    if ($host === '' || $username === '' || $password === '' || $fromEmail === '') {
        return ['ok' => false, 'message' => 'SMTP is not configured. Edit api/config.local.json.'];
    }

    $to = trim($to);
    if ($to === '' || !elenest_is_valid_email($to)) {
        return ['ok' => false, 'message' => 'Invalid recipient email.'];
    }

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encodedFromName = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
    $bodyText = str_replace(["\r\n", "\r"], "\n", $bodyText);
    $bodyText = str_replace("\n", "\r\n", $bodyText);

    $headers = [
        'From: ' . $encodedFromName . ' <' . $fromEmail . '>',
        'To: ' . $to,
        'Subject: ' . $encodedSubject,
        'MIME-Version: 1.0',
        'X-Mailer: Elenest-Resort',
    ];
    if ($replyTo !== null && elenest_is_valid_email($replyTo)) {
        $headers[] = 'Reply-To: ' . $replyTo;
    }

    $html = is_string($bodyHtml) ? trim($bodyHtml) : '';
    if ($html !== '') {
        $boundary = 'elenest_' . bin2hex(random_bytes(8));
        $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
        $html = str_replace(["\r\n", "\r"], "\n", $html);
        $html = str_replace("\n", "\r\n", $html);
        $messageBody =
            '--' . $boundary . "\r\n" .
            'Content-Type: text/plain; charset=UTF-8' . "\r\n" .
            'Content-Transfer-Encoding: 8bit' . "\r\n\r\n" .
            $bodyText . "\r\n\r\n" .
            '--' . $boundary . "\r\n" .
            'Content-Type: text/html; charset=UTF-8' . "\r\n" .
            'Content-Transfer-Encoding: 8bit' . "\r\n\r\n" .
            $html . "\r\n\r\n" .
            '--' . $boundary . '--';
    } else {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
        $messageBody = $bodyText;
    }

    $message = implode("\r\n", $headers) . "\r\n\r\n" . $messageBody;

    try {
        if ($port === 465) {
            $socket = @stream_socket_client(
                'ssl://' . $host . ':465',
                $errno,
                $errstr,
                30,
                STREAM_CLIENT_CONNECT,
                stream_context_create([
                    'ssl' => [
                        'verify_peer' => true,
                        'verify_peer_name' => true,
                        'allow_self_signed' => false,
                    ],
                ])
            );
        } else {
            $socket = @stream_socket_client(
                'tcp://' . $host . ':' . $port,
                $errno,
                $errstr,
                30,
                STREAM_CLIENT_CONNECT
            );
        }

        if ($socket === false) {
            $detail = $errstr ?: 'connection failed';
            if (stripos($detail, 'refused') !== false || stripos($detail, 'timed out') !== false) {
                $detail .= '. Outbound SMTP (ports 465/587) may be blocked by your ISP, router, or firewall. Try another network (e.g. mobile hotspot) or allow PHP/Apache to send on port ' . $port . '.';
            }
            return ['ok' => false, 'message' => 'Could not connect to SMTP server: ' . $detail];
        }

        stream_set_timeout($socket, 30);

        $read = static function () use ($socket): string {
            $response = '';
            while (($line = fgets($socket, 515)) !== false) {
                $response .= $line;
                if (isset($line[3]) && $line[3] === ' ') {
                    break;
                }
            }
            return $response;
        };

        $write = static function (string $command) use ($socket, $read): string {
            fwrite($socket, $command . "\r\n");
            return $read();
        };

        $expect = static function (string $response, array $codes): void {
            $code = (int) substr($response, 0, 3);
            if (!in_array($code, $codes, true)) {
                throw new RuntimeException(trim($response) !== '' ? trim($response) : 'Unexpected SMTP response.');
            }
        };

        $expect($read(), [220]);

        if ($port !== 465) {
            $expect($write('EHLO localhost'), [250]);
            if ($port === 587) {
                $expect($write('STARTTLS'), [220]);
                if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('Could not start TLS with SMTP server.');
                }
                $expect($write('EHLO localhost'), [250]);
            }
        } else {
            $expect($write('EHLO localhost'), [250]);
        }

        $expect($write('AUTH LOGIN'), [334]);
        $expect($write(base64_encode($username)), [334]);
        $expect($write(base64_encode($password)), [235]);
        $expect($write('MAIL FROM:<' . $fromEmail . '>'), [250]);
        $expect($write('RCPT TO:<' . $to . '>'), [250, 251]);
        $expect($write('DATA'), [354]);
        $expect($write($message . "\r\n."), [250]);
        $write('QUIT');

        fclose($socket);
    } catch (Throwable $e) {
        if (isset($socket) && is_resource($socket)) {
            fclose($socket);
        }
        return ['ok' => false, 'message' => $e->getMessage()];
    }

    return ['ok' => true, 'message' => 'Email sent.'];
}
