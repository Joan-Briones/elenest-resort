"""Load API secrets from JSON (preferred) or legacy PHP config files."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

API_DIR = Path(__file__).resolve().parent.parent


def _parse_php_config(path: Path) -> dict[str, Any]:
    """Extract string/int values from a simple PHP return-array config file."""
    text = path.read_text(encoding="utf-8", errors="replace")
    config: dict[str, Any] = {}

    for match in re.finditer(
        r"['\"]([a-zA-Z0-9_]+)['\"]\s*=>\s*(?:'([^']*)'|\"([^\"]*)\"|(\d+))",
        text,
    ):
        key = match.group(1)
        if match.group(4) is not None:
            config[key] = int(match.group(4))
        else:
            config[key] = match.group(2) if match.group(2) is not None else match.group(3)

    return config


def load_config() -> dict[str, Any]:
    local_json = API_DIR / "config.local.json"
    example_json = API_DIR / "config.example.json"
    local_php = API_DIR / "config.local.php"
    example_php = API_DIR / "config.example.php"

    if local_json.is_file():
        data = json.loads(local_json.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}

    if local_php.is_file():
        return _parse_php_config(local_php)

    if example_json.is_file():
        data = json.loads(example_json.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}

    if example_php.is_file():
        return _parse_php_config(example_php)

    return {}
