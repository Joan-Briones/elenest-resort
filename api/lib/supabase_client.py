"""Supabase REST helpers — same behavior as api/_lib/supabase.php."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import requests

TIMEOUT = 20


def supabase_ensure_user_row(url: str, service_key: str, phone_number: str) -> str | None:
    existing = supabase_get_user_by_phone(url, service_key, phone_number)
    if existing is not None:
        return None

    result = supabase_request(
        url,
        service_key,
        "POST",
        "/rest/v1/users",
        {
            "phone_number": phone_number,
            "is_verified": False,
        },
        ["Prefer: return=minimal"],
    )

    if not result["ok"] and "duplicate" in str(result["message"]).lower():
        return None

    return None if result["ok"] else result["message"]


def supabase_mark_verified(url: str, service_key: str, phone_number: str) -> str | None:
    result = supabase_request(
        url,
        service_key,
        "POST",
        "/rest/v1/users?on_conflict=phone_number",
        {
            "phone_number": phone_number,
            "is_verified": True,
        },
        ["Prefer: resolution=merge-duplicates,return=minimal"],
    )
    return None if result["ok"] else result["message"]


def supabase_get_user_by_phone(url: str, service_key: str, phone_number: str) -> dict | None:
    path = (
        "/rest/v1/users?phone_number=eq."
        + quote(phone_number, safe="")
        + "&select=id,phone_number,is_verified&limit=1"
    )
    result = supabase_request(url, service_key, "GET", path)

    if not result["ok"] or not isinstance(result["data"], list) or len(result["data"]) == 0:
        return None

    return result["data"][0]


def supabase_request(
    url: str,
    service_key: str,
    method: str,
    path: str,
    body: dict | list | None = None,
    extra_headers: list[str] | None = None,
) -> dict[str, Any]:
    endpoint = url.rstrip("/") + path
    is_jwt = service_key.startswith("eyJ")

    headers = {
        "Content-Type": "application/json",
        "apikey": service_key,
    }
    if is_jwt:
        headers["Authorization"] = f"Bearer {service_key}"

    for raw in extra_headers or []:
        if ":" in raw:
            key, value = raw.split(":", 1)
            headers[key.strip()] = value.strip()

    try:
        response = requests.request(
            method,
            endpoint,
            headers=headers,
            json=body if body is not None else None,
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        return {
            "ok": False,
            "http_code": 0,
            "message": str(exc) or "Could not reach Supabase.",
            "data": None,
        }

    http_code = response.status_code
    try:
        data = response.json()
    except ValueError:
        data = None

    ok = 200 <= http_code < 300
    message = "OK"
    if not ok:
        if isinstance(data, dict) and data.get("message") is not None:
            message = str(data["message"])
        elif isinstance(data, dict) and data.get("error") is not None:
            message = str(data["error"])
        elif isinstance(data, dict) and data.get("msg") is not None:
            message = str(data["msg"])
        else:
            message = "Supabase request failed."
        if isinstance(data, dict) and data.get("details"):
            message += " " + str(data["details"])
        if service_key.startswith("sbp_"):
            message += (
                " Tip: use Project Settings → API Keys → secret key (sb_secret_...)"
                " in api/config.local.json, not a personal sbp_ token."
            )

    return {
        "ok": ok,
        "http_code": http_code,
        "message": message,
        "data": data,
    }
