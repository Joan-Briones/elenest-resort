"""SMTP mailer — same behavior as api/_lib/smtp.php."""

from __future__ import annotations

import re
import smtplib
import ssl
from email.message import EmailMessage
from typing import Any


def _is_valid_email(value: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^\s@]+$", value))


def smtp_send_mail(
    smtp: dict[str, Any],
    to: str,
    subject: str,
    body_text: str,
    reply_to: str | None = None,
) -> dict[str, Any]:
    host = str(smtp.get("host") or "").strip()
    port = int(smtp.get("port") or 465)
    username = str(smtp.get("username") or "").strip()
    # Gmail App Passwords are often shown with spaces; SMTP login needs letters/digits only.
    password = re.sub(r"\s+", "", str(smtp.get("password") or ""))
    from_name = str(smtp.get("from_name") or "Elenest Resort").strip()
    from_email = str(smtp.get("from_email") or username).strip()

    if not host or not username or not password or not from_email:
        return {"ok": False, "message": "SMTP is not configured. Edit api/config.local.json."}

    to = to.strip()
    if not to or not _is_valid_email(to):
        return {"ok": False, "message": "Invalid recipient email."}

    msg = EmailMessage()
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg["X-Mailer"] = "Elenest-Resort"
    if reply_to and _is_valid_email(reply_to):
        msg["Reply-To"] = reply_to
    msg.set_content(body_text or "", charset="utf-8")

    context = ssl.create_default_context()
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=30, context=context) as server:
                server.ehlo()
                server.login(username, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.ehlo()
                if port == 587:
                    server.starttls(context=context)
                    server.ehlo()
                server.login(username, password)
                server.send_message(msg)
    except Exception as exc:  # noqa: BLE001 — mirror PHP catch-all message
        return {"ok": False, "message": str(exc)}

    return {"ok": True, "message": "Email sent."}
