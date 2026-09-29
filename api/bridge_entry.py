"""
CLI bridge used by the thin Apache PHP wrappers.
Reads JSON from stdin: {"handler": "...", "body": {...}}
Writes JSON to stdout: {"status": 200, "body": {...}}
"""

from __future__ import annotations

import json
import re
import secrets
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from lib.config import load_config
from lib.iprog import iprog_detect_network, iprog_send_otp, iprog_verify_otp
from lib.phone import is_valid_philippine_phone, normalize_philippine_phone
from lib.smtp_mail import smtp_send_mail
from lib.supabase_client import (
    supabase_ensure_user_row,
    supabase_mark_verified,
    supabase_request,
)


def _is_email(value: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value))


def _supabase_configured(url: str, key: str) -> bool:
    return bool(
        url
        and key
        and key
        not in (
            "YOUR_SUPABASE_SERVICE_ROLE_KEY",
            "PASTE_YOUR_SB_SECRET_KEY_HERE",
            "YOUR_SUPABASE_SECRET_OR_SERVICE_ROLE_KEY",
        )
    )


def handle_send_otp(body: dict) -> tuple[int, dict]:
    config = load_config()
    api_token = str(config.get("iprog_sms_api_token") or "").strip()
    supabase_url = str(config.get("supabase_url") or "").strip()
    service_key = str(config.get("supabase_service_role_key") or "").strip()

    if not api_token or api_token == "YOUR_IPROG_API_TOKEN":
        return 500, {"ok": False, "message": "iProg SMS is not configured. Edit api/config.local.json."}

    phone_number = normalize_philippine_phone(body.get("phone_number") or "")
    if not phone_number or not is_valid_philippine_phone(phone_number):
        return 400, {
            "ok": False,
            "message": "Invalid phone number. Use Philippine mobile format: 09XXXXXXXXX.",
        }

    if _supabase_configured(supabase_url, service_key):
        supabase_ensure_user_row(supabase_url, service_key, phone_number)

    result = iprog_detect_network(api_token, phone_number)
    if result["ok"] and not result.get("supported"):
        return 422, {
            "ok": False,
            "message": (
                "SMS cannot be delivered to "
                + str(result.get("network") or "")
                + " numbers with iProg default sender. Use Globe, TM, DITO, or GOMO,"
                " or check iprogsms.com dashboard if testing."
            ),
            "network": result.get("network"),
            "is_smart_tnt": bool(result.get("is_smart_tnt")),
        }

    network_label = (result.get("network") if result["ok"] else "Unknown") or "Unknown"
    result = iprog_send_otp(api_token, phone_number)
    if not result["ok"]:
        return 502, {
            "ok": False,
            "message": result.get("message")
            or "Could not send OTP. Check iProg credits and phone network.",
        }

    return 200, {
        "ok": True,
        "message": (
            "Verification code sent to your phone. If you use Smart/TNT and did not"
            " receive it, that network is not supported — try Globe/TM/DITO/GOMO."
        ),
        "phone_number": phone_number,
        "network": network_label,
    }


def handle_verify_otp(body: dict) -> tuple[int, dict]:
    config = load_config()
    api_token = str(config.get("iprog_sms_api_token") or "").strip()
    supabase_url = str(config.get("supabase_url") or "").strip()
    service_key = str(config.get("supabase_service_role_key") or "").strip()

    if not api_token or api_token == "YOUR_IPROG_API_TOKEN":
        return 500, {"ok": False, "message": "iProg SMS is not configured. Edit api/config.local.json."}

    phone_number = normalize_philippine_phone(body.get("phone_number") or "")
    otp = str(body.get("otp") or "").strip()

    if not phone_number or not is_valid_philippine_phone(phone_number):
        return 400, {
            "ok": False,
            "message": "Invalid phone number. Use Philippine mobile format: 09XXXXXXXXX.",
        }

    if not re.match(r"^[0-9]{4,8}$", otp):
        return 400, {"ok": False, "message": "Invalid verification code format."}

    result = iprog_verify_otp(api_token, phone_number, otp)
    if not result["ok"]:
        return 401, {
            "ok": False,
            "message": result.get("message") or "Invalid or expired verification code.",
        }

    if _supabase_configured(supabase_url, service_key):
        supabase_mark_verified(supabase_url, service_key, phone_number)

    return 200, {
        "ok": True,
        "message": "Phone number verified successfully.",
        "phone_number": phone_number,
        "is_verified": True,
    }


def handle_submit_contact_message(body: dict) -> tuple[int, dict]:
    config = load_config()
    supabase_url = str(config.get("supabase_url") or "").strip()
    service_key = str(config.get("supabase_service_role_key") or "").strip()

    if not _supabase_configured(supabase_url, service_key):
        return 500, {"ok": False, "message": "Supabase is not configured. Edit api/config.local.json."}

    email = str(body.get("email") or "").strip()
    name = str(body.get("name") or "").strip()
    message = str(body.get("message") or "").strip()
    msg_id = str(body.get("id") or "").strip()

    if not email or not _is_email(email):
        return 400, {
            "ok": False,
            "message": "A valid email is required so we can reply to your inbox.",
        }

    if not name:
        name = "Guest"
    if not msg_id:
        msg_id = "msg-" + secrets.token_hex(8)

    row = {
        "id": msg_id,
        "name": name,
        "email": email,
        "message": message,
        "status": "new",
        "reply": "",
    }

    result = supabase_request(
        supabase_url,
        service_key,
        "POST",
        "/rest/v1/customer_messages",
        row,
        ["Prefer: return=representation"],
    )

    if not result["ok"]:
        return 502, {
            "ok": False,
            "message": result.get("message") or "Could not save your message.",
        }

    saved = None
    data = result.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        saved = data[0]
    elif isinstance(data, dict):
        saved = data

    return 200, {
        "ok": True,
        "message": "Message sent. Thank you!",
        "item": saved or row,
    }


def handle_send_contact_reply(body: dict) -> tuple[int, dict]:
    config = load_config()
    smtp = {
        "host": str(config.get("smtp_host") or ""),
        "port": int(config.get("smtp_port") or 465),
        "username": str(config.get("smtp_username") or ""),
        "password": str(config.get("smtp_password") or ""),
        "from_name": str(config.get("smtp_from_name") or "Elenest Resort"),
        "from_email": str(config.get("smtp_from_email") or ""),
    }

    if (
        not str(smtp["host"]).strip()
        or not str(smtp["username"]).strip()
        or not str(smtp["password"]).strip()
        or not str(smtp["from_email"]).strip()
    ):
        return 500, {"ok": False, "message": "SMTP is not configured. Edit api/config.local.json."}

    to = str(body.get("to") or "").strip()
    guest_name = str(body.get("name") or "Guest").strip()
    reply = str(body.get("reply") or "").strip()
    original = str(body.get("original_message") or "").strip()
    message_id = str(body.get("message_id") or "").strip()

    if not to or not _is_email(to):
        return 400, {"ok": False, "message": "A valid customer email is required."}

    if not reply:
        return 400, {"ok": False, "message": "Reply message is required."}

    if not guest_name:
        guest_name = "Guest"

    from_name = str(smtp["from_name"] or "Elenest Resort")
    subject = "Re: Your message to Elenest Resort"
    lines = [
        f"Good day, {guest_name}!",
        "",
        "Thank you for reaching out to Elenest Resort. We truly appreciate your message and the time you took to contact us.",
        "",
        "Here is our response:",
        "",
        reply,
        "",
        "If you have any other questions or need further assistance, please feel free to reply to this email. We are always happy to help.",
        "",
        "Thank you once again for choosing Elenest Resort. We look forward to welcoming you soon.",
        "",
        "Warm regards,",
        from_name,
        "Elenest Resort Team",
    ]
    if original:
        lines.extend(["", "---", "Your original message:", original])

    result = smtp_send_mail(smtp, to, subject, "\r\n".join(lines), smtp["from_email"])
    if not result["ok"]:
        return 502, {
            "ok": False,
            "message": result.get("message") or "Could not send email.",
            "message_id": message_id or None,
        }

    return 200, {
        "ok": True,
        "message": f"Reply emailed to {to}.",
        "message_id": message_id or None,
    }


HANDLERS = {
    "send_otp": handle_send_otp,
    "verify_otp": handle_verify_otp,
    "submit_contact_message": handle_submit_contact_message,
    "send_contact_reply": handle_send_contact_reply,
}


def main() -> None:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        print(json.dumps({"status": 400, "body": {"ok": False, "message": "Invalid JSON body."}}))
        return

    handler_name = str(payload.get("handler") or "").strip()
    body = payload.get("body") if isinstance(payload.get("body"), dict) else {}
    handler = HANDLERS.get(handler_name)
    if not handler:
        print(
            json.dumps(
                {
                    "status": 500,
                    "body": {"ok": False, "message": f"Unknown handler: {handler_name}"},
                }
            )
        )
        return

    try:
        status, response_body = handler(body)
    except Exception as exc:  # noqa: BLE001
        status, response_body = 500, {"ok": False, "message": str(exc)}

    print(json.dumps({"status": status, "body": response_body}, ensure_ascii=False))


if __name__ == "__main__":
    main()
