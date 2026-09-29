"""Philippine mobile phone helpers (same rules as the former PHP bootstrap)."""

from __future__ import annotations

import re


def normalize_philippine_phone(raw) -> str | None:
    digits = re.sub(r"\D+", "", str(raw or ""))
    if len(digits) == 11 and digits.startswith("09"):
        return digits
    if len(digits) == 12 and digits.startswith("639"):
        return "0" + digits[2:]
    if len(digits) == 10 and digits.startswith("9"):
        return "0" + digits
    return None


def is_valid_philippine_phone(phone: str) -> bool:
    return bool(re.match(r"^09[0-9]{9}$", phone))
