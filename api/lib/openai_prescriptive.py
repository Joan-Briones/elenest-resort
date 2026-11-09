"""Server-side OpenAI call for prescriptive recommendations.

The API key is read from api/config.local.json (openai_api_key) or the
OPENAI_API_KEY environment variable. It is never sent to the browser.
"""

from __future__ import annotations

import json
import os
from typing import Any

import requests

ALLOWED_CATEGORIES = {
    "staffing",
    "promotion",
    "facilities",
    "maintenance",
    "revenue",
    "reputation",
}
ALLOWED_PRIORITY = {"high", "medium"}


def resolve_openai_key(config: dict[str, Any]) -> str:
    current = str(config.get("openai_api_key") or "").strip()
    from_env = os.environ.get("OPENAI_API_KEY", "").strip()
    if from_env and (not current or current.startswith("YOUR_")):
        return from_env
    return current


def resolve_model(config: dict[str, Any]) -> str:
    current = str(config.get("openai_model") or "").strip()
    from_env = os.environ.get("OPENAI_MODEL", "").strip()
    if from_env and (not current or current.startswith("YOUR_")):
        return from_env
    return current or "gpt-4o-mini"


def _clip(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit].strip()


def _compact_forecasts(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:12]:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "year": int(item.get("year") or 0),
                "month": int(item.get("month") or 0),
                "bookings": item.get("predicted_bookings"),
                "guests": item.get("predicted_guests"),
                "revenue": item.get("predicted_revenue"),
                "occupancy": item.get("predicted_occupancy"),
            }
        )
    return out


def _compact_draft(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:6]:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category") or "").strip().lower()
        if category not in ALLOWED_CATEGORIES:
            continue
        priority = str(item.get("priority") or "medium").strip().lower()
        if priority not in ALLOWED_PRIORITY:
            priority = "medium"
        out.append(
            {
                "category": category,
                "priority": priority,
                "year": int(item.get("year") or 0),
                "month": int(item.get("month") or 0),
                "title": _clip(item.get("title"), 120),
                "detail": _clip(item.get("detail"), 400),
            }
        )
    return out


def rewrite_recommendations(config: dict[str, Any], body: dict[str, Any]) -> tuple[int, dict]:
    key = resolve_openai_key(config)
    if not key or key.startswith("YOUR_"):
        return 200, {
            "ok": False,
            "code": "not_configured",
            "message": "Add openai_api_key to api/config.local.json, or set OPENAI_API_KEY.",
        }

    drafts = _compact_draft(body.get("recommendations"))
    forecasts = _compact_forecasts(body.get("forecasts"))
    if not drafts or not forecasts:
        return 400, {"ok": False, "message": "Forecast recommendations are required."}

    feedback = body.get("feedback") if isinstance(body.get("feedback"), dict) else {}
    model = resolve_model(config)
    payload = {
        "facility": _clip(body.get("facility") or "all facilities", 40),
        "forecasts": forecasts,
        "feedback": {
            "total": feedback.get("totalFeedback") or feedback.get("total") or 0,
            "positive_share": feedback.get("positiveShare") or feedback.get("positive_share") or 0,
            "average_rating": feedback.get("avgRating") or feedback.get("average_rating") or 0,
        },
        "drafts": drafts,
    }
    system = (
        "You write short staff actions for Elenest Resort. "
        "Use only the forecast numbers given. Do not invent bookings, guests, or money. "
        "Rewrite each draft into a clear action. Keep the same category, year, and month. "
        'Return JSON only: {"recommendations":[{"category","priority","year","month","title","detail"}]}. '
        "priority is high or medium. title under 90 characters. detail under 280 characters."
    )

    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            },
            timeout=25,
        )
    except requests.RequestException:
        return 502, {"ok": False, "message": "Could not reach OpenAI."}

    if response.status_code == 401:
        return 502, {"ok": False, "message": "OpenAI rejected the API key."}
    if response.status_code >= 400:
        return 502, {"ok": False, "message": "OpenAI did not return recommendations."}

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (ValueError, KeyError, IndexError, TypeError):
        return 502, {"ok": False, "message": "OpenAI returned an unreadable answer."}

    items = parsed.get("recommendations") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return 502, {"ok": False, "message": "OpenAI returned an unreadable answer."}

    by_category: dict[str, dict[str, str]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category") or "").strip().lower()
        if category not in ALLOWED_CATEGORIES or category in by_category:
            continue
        priority = str(item.get("priority") or "").strip().lower()
        if priority not in ALLOWED_PRIORITY:
            priority = ""
        title = _clip(item.get("title"), 90)
        detail = _clip(item.get("detail"), 280)
        if not title or not detail:
            continue
        by_category[category] = {"priority": priority, "title": title, "detail": detail}

    merged = []
    for draft in drafts:
        rewritten = by_category.get(draft["category"])
        if not rewritten:
            continue
        merged.append(
            {
                "category": draft["category"],
                "priority": rewritten["priority"] or draft["priority"],
                "year": draft["year"],
                "month": draft["month"],
                "title": rewritten["title"],
                "detail": rewritten["detail"],
                "source": "openai",
            }
        )

    if not merged:
        return 502, {"ok": False, "message": "OpenAI returned no usable actions."}

    return 200, {"ok": True, "model": model, "recommendations": merged}
