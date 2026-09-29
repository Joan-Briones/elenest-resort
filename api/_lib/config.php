<?php

declare(strict_types=1);

function elenest_load_config(): array
{
    $apiDir = dirname(__DIR__);

    $localJson = $apiDir . DIRECTORY_SEPARATOR . 'config.local.json';
    if (is_file($localJson)) {
        $data = json_decode((string) file_get_contents($localJson), true);
        return is_array($data) ? $data : [];
    }

    $localPhp = $apiDir . DIRECTORY_SEPARATOR . 'config.local.php';
    if (is_file($localPhp)) {
        $data = require $localPhp;
        return is_array($data) ? $data : [];
    }

    $exampleJson = $apiDir . DIRECTORY_SEPARATOR . 'config.example.json';
    if (is_file($exampleJson)) {
        $data = json_decode((string) file_get_contents($exampleJson), true);
        return is_array($data) ? $data : [];
    }

    return [];
}
