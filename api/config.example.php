<?php
/**
 * Optional legacy template. Prefer config.example.json → config.local.json
 * (Python loads JSON first, then falls back to config.local.php).
 *
 * Copy this file to config.local.php only if you still want a PHP-format config.
 * Local secret files are gitignored — keep secrets there only.
 */
return [
    'iprog_sms_api_token' => 'YOUR_IPROG_API_TOKEN',
    'supabase_url' => 'https://wstgqfcdpfifkqyrclkx.supabase.co',
    // Supabase Dashboard → Project Settings → API Keys → Secret key (sb_secret_...)
    // or Legacy service_role JWT (eyJ...). Do NOT use a personal sbp_ token.
    'supabase_service_role_key' => 'YOUR_SUPABASE_SECRET_OR_SERVICE_ROLE_KEY',

    // Gmail SMTP (use an App Password, not your normal Gmail password)
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 465,
    'smtp_username' => 'YOUR_GMAIL@gmail.com',
    'smtp_password' => 'YOUR_GMAIL_APP_PASSWORD',
    'smtp_from_name' => 'Elenest Resort',
    'smtp_from_email' => 'YOUR_GMAIL@gmail.com',
];
