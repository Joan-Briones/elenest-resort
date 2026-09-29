<?php

declare(strict_types=1);

function elenest_digits_only(string $raw): string
{
    return preg_replace('/\D+/', '', $raw) ?? '';
}

function elenest_normalize_philippine_phone(string $raw): ?string
{
    $digits = elenest_digits_only($raw);

    if (strlen($digits) === 11 && str_starts_with($digits, '09')) {
        return $digits;
    }
    if (strlen($digits) === 12 && str_starts_with($digits, '639')) {
        return '0' . substr($digits, 2);
    }
    if (strlen($digits) === 10 && str_starts_with($digits, '9')) {
        return '0' . $digits;
    }

    return null;
}

function elenest_is_valid_philippine_phone(string $phone): bool
{
    return (bool) preg_match('/^09[0-9]{9}$/', $phone);
}
