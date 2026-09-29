<?php

declare(strict_types=1);

/**
 * Thin Apache entry: all API logic runs in Python (bridge_entry.py).
 * Keeps the same /api/*.php URLs the frontend already uses.
 */

function python_bridge_is_windows_apps_stub(string $path): bool
{
    $normalized = str_replace('/', '\\', strtolower($path));
    return str_contains($normalized, '\\windowsapps\\');
}

function python_bridge_normalize_exe(string $path): ?string
{
    $path = trim($path);
    if ($path === '') {
        return null;
    }
    $path = str_replace('/', '\\', $path);
    if (!is_file($path) || python_bridge_is_windows_apps_stub($path)) {
        return null;
    }
    return $path;
}

function python_bridge_localappdata_candidates(): array
{
    $bases = [];

    foreach ([getenv('LOCALAPPDATA'), getenv('USERPROFILE') ? getenv('USERPROFILE') . '\\AppData\\Local' : null] as $base) {
        if (is_string($base) && $base !== '') {
            $bases[] = $base;
        }
    }

    // Apache service often has empty LOCALAPPDATA — scan common user profiles.
    $usersRoot = 'C:\\Users';
    if (is_dir($usersRoot)) {
        foreach (scandir($usersRoot) ?: [] as $user) {
            if ($user === '.' || $user === '..' || $user === 'Public' || $user === 'Default' || $user === 'Default User' || $user === 'All Users') {
                continue;
            }
            $bases[] = $usersRoot . '\\' . $user . '\\AppData\\Local';
        }
    }

    $versions = ['Python314', 'Python313', 'Python312', 'Python311'];
    $out = [];
    foreach (array_unique($bases) as $base) {
        foreach ($versions as $ver) {
            $out[] = $base . '\\Programs\\Python\\' . $ver . '\\python.exe';
        }
    }
    return $out;
}

function python_bridge_find_executable(): ?string
{
    // Preferred: pinned path written after install (works under Apache/XAMPP).
    $pinFile = __DIR__ . DIRECTORY_SEPARATOR . 'python.path';
    if (is_file($pinFile)) {
        $pinned = python_bridge_normalize_exe((string) file_get_contents($pinFile));
        if ($pinned !== null) {
            return $pinned;
        }
    }

    $candidates = array_merge(
        python_bridge_localappdata_candidates(),
        [
            'C:\\Python314\\python.exe',
            'C:\\Python313\\python.exe',
            'C:\\Python312\\python.exe',
            'C:\\Python311\\python.exe',
            'py',
            'python',
            'python3',
        ]
    );

    foreach ($candidates as $bin) {
        if (!$bin) {
            continue;
        }

        if (is_file($bin)) {
            $normalized = python_bridge_normalize_exe($bin);
            if ($normalized !== null) {
                return $normalized;
            }
            continue;
        }

        $which = stripos(PHP_OS, 'WIN') === 0 ? 'where' : 'which';
        $out = [];
        $code = 0;
        @exec($which . ' ' . escapeshellarg($bin) . ' 2>nul', $out, $code);
        if ($code === 0 && !empty($out)) {
            foreach ($out as $line) {
                $resolved = python_bridge_normalize_exe(trim((string) $line));
                if ($resolved !== null) {
                    return $resolved;
                }
            }
        }
    }

    $out = [];
    $code = 0;
    @exec('py -3 -c "import sys; print(sys.executable)" 2>nul', $out, $code);
    if ($code === 0 && !empty($out[0])) {
        $resolved = python_bridge_normalize_exe(trim((string) $out[0]));
        if ($resolved !== null) {
            return $resolved;
        }
    }

    return null;
}

function python_bridge_decode_stdout(string $stdout): ?array
{
    $text = $stdout;

    // Strip UTF-8 BOM
    if (str_starts_with($text, "\xEF\xBB\xBF")) {
        $text = substr($text, 3);
    }

    // Windows sometimes emits UTF-16LE when PYTHONUTF8 is unset under Apache.
    if ($text !== '' && str_starts_with($text, "{\x00")) {
        $converted = @mb_convert_encoding($text, 'UTF-8', 'UTF-16LE');
        if (is_string($converted) && $converted !== '') {
            $text = $converted;
        }
    }

    $text = trim($text);
    if ($text === '') {
        return null;
    }

    // If logs leaked before JSON, take the last JSON object line.
    if ($text[0] !== '{') {
        $pos = strrpos($text, '{');
        if ($pos !== false) {
            $text = substr($text, $pos);
        }
    }

    $result = json_decode($text, true);
    return is_array($result) ? $result : null;
}

function python_bridge_run(string $handler): void
{
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

    $python = python_bridge_find_executable();
    if ($python === null) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok' => false,
            'message' => 'Python 3 was not found. Put the full path in api/python.path (one line), then retry.',
        ]);
        exit;
    }

    $raw = file_get_contents('php://input');
    $body = [];
    if ($raw) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $body = $decoded;
        }
    }

    $payload = json_encode([
        'handler' => $handler,
        'body' => $body,
    ], JSON_UNESCAPED_UNICODE);

    $script = __DIR__ . DIRECTORY_SEPARATOR . 'bridge_entry.py';
    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $env = [
        'PATH' => dirname($python) . ';' . dirname($python) . '\\Scripts;' . (getenv('PATH') ?: ''),
        'SYSTEMROOT' => getenv('SYSTEMROOT') ?: 'C:\\Windows',
        'WINDIR' => getenv('WINDIR') ?: 'C:\\Windows',
        'TEMP' => getenv('TEMP') ?: (sys_get_temp_dir()),
        'TMP' => getenv('TMP') ?: (sys_get_temp_dir()),
        'PYTHONUTF8' => '1',
        'PYTHONIOENCODING' => 'utf-8',
        'PYTHONUNBUFFERED' => '1',
    ];

    $cmd = escapeshellarg($python) . ' -X utf8 ' . escapeshellarg($script);
    $proc = proc_open($cmd, $descriptors, $pipes, __DIR__, $env, ['bypass_shell' => false]);

    if (!is_resource($proc)) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'message' => 'Could not start Python API bridge.']);
        exit;
    }

    fwrite($pipes[0], $payload === false ? '{}' : $payload);
    fclose($pipes[0]);

    $stdout = (string) stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = (string) stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $exitCode = proc_close($proc);

    $result = python_bridge_decode_stdout($stdout);
    if ($result === null || !isset($result['body'])) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        $hint = trim($stderr);
        if ($hint === '') {
            $preview = trim(preg_replace('/[^\x20-\x7E]+/', ' ', $stdout) ?? '');
            $hint = $preview !== ''
                ? ('Unexpected Python output: ' . substr($preview, 0, 180))
                : ('Python API bridge failed (exit ' . $exitCode . '). Using: ' . $python);
        } else {
            $hint = 'Python API error: ' . $hint;
        }
        echo json_encode(['ok' => false, 'message' => $hint]);
        exit;
    }

    $status = (int) ($result['status'] ?? 200);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result['body'], JSON_UNESCAPED_UNICODE);
    exit;
}
