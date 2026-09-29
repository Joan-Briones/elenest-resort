"""iProg SMS client — same behavior as api/_lib/iprog.php."""

from __future__ import annotations

from typing import Any

import requests

TIMEOUT = 30


def iprog_send_otp(api_token: str, phone_number: str) -> dict[str, Any]:
    international = "63" + phone_number[1:]
    attempts = [
        {"phone_number": phone_number, "label": "local"},
        {"phone_number": international, "label": "international"},
    ]

    last_result: dict[str, Any] | None = None
    for attempt in attempts:
        result = iprog_post(
            "https://www.iprogsms.com/api/v1/otp/send_otp",
            {
                "api_token": api_token,
                "phone_number": attempt["phone_number"],
                "message": "Your Elenest Resort code is :otp. Valid 5 minutes.",
                "expires_in_minutes": 5,
            },
        )
        result["phone_format"] = attempt["label"]
        last_result = result
        if result["ok"]:
            return result

    return last_result or {
        "ok": False,
        "http_code": 0,
        "message": "Could not send OTP.",
        "raw": None,
    }


def iprog_verify_otp(api_token: str, phone_number: str, otp: str) -> dict[str, Any]:
    international = "63" + phone_number[1:]
    attempts = [phone_number, international]
    last_result: dict[str, Any] | None = None

    for candidate in attempts:
        result = iprog_post(
            "https://www.iprogsms.com/api/v1/otp/verify_otp",
            {
                "api_token": api_token,
                "phone_number": candidate,
                "otp": otp,
            },
        )
        last_result = result
        if result["ok"]:
            return result

    return last_result or {
        "ok": False,
        "http_code": 0,
        "message": "OTP verification failed.",
        "raw": None,
    }


def iprog_detect_network(api_token: str, phone_number: str) -> dict[str, Any]:
    result = iprog_post(
        "https://www.iprogsms.com/api/v1/phone_numbers/detect",
        {
            "api_token": api_token,
            "phone_number": phone_number,
        },
    )

    if not result["ok"] or not isinstance(result.get("raw"), dict):
        return {
            "ok": False,
            "network": "Unknown",
            "is_smart_tnt": False,
            "supported": True,
            "message": result.get("message") or "Could not detect network.",
        }

    data = result["raw"].get("data")
    data = data if isinstance(data, dict) else {}
    network = str(data.get("network") or "Unknown")
    is_smart_tnt = bool(data.get("is_smart_tnt"))
    invalid = "invalid" in network.lower()
    supported = (
        not is_smart_tnt
        and not invalid
        and "smart" not in network.lower()
        and "tnt" not in network.lower()
    )

    return {
        "ok": True,
        "network": network,
        "is_smart_tnt": is_smart_tnt,
        "supported": supported,
        "message": (
            "Network supported for SMS delivery."
            if supported
            else "This mobile network cannot receive iProg SMS with the default sender."
        ),
    }


def iprog_post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        return {
            "ok": False,
            "http_code": 0,
            "message": str(exc) or "Could not reach iProg SMS.",
            "raw": None,
        }

    http_code = response.status_code
    try:
        data = response.json()
    except ValueError:
        return {
            "ok": False,
            "http_code": http_code,
            "message": "Invalid response from iProg SMS.",
            "raw": response.text,
        }

    if not isinstance(data, dict):
        return {
            "ok": False,
            "http_code": http_code,
            "message": "Invalid response from iProg SMS.",
            "raw": response.text,
        }

    status = str(data.get("status") or "")
    ok = 200 <= http_code < 300 and status == "success"

    return {
        "ok": ok,
        "http_code": http_code,
        "message": str(data.get("message") or ("Success." if ok else "Request failed.")),
        "raw": data,
    }
