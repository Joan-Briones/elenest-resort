"""
Elenest Resort API — Python (Flask).

Same routes, same JSON request/response shapes as the XAMPP bridges.
Preferred on XAMPP: /api/*.php (thin bridges → bridge_entry.py).
Optional direct server: run-api.bat → http://127.0.0.1:5000
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request

API_DIR = Path(__file__).resolve().parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from bridge_entry import HANDLERS  # noqa: E402

app = Flask(__name__)


@app.after_request
def after_request(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def send_json(payload: dict, status: int = 200):
    return jsonify(payload), status


def read_json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def dispatch(handler_name: str):
    if request.method == "OPTIONS":
        return ("", 204)
    if request.method != "POST":
        return send_json({"ok": False, "message": "Method not allowed."}, 405)

    handler = HANDLERS[handler_name]
    status, body = handler(read_json_body())
    return send_json(body, status)


@app.route("/api/send-otp.php", methods=["POST", "OPTIONS"])
@app.route("/api/send-otp", methods=["POST", "OPTIONS"])
@app.route("/send-otp.php", methods=["POST", "OPTIONS"])
@app.route("/send-otp", methods=["POST", "OPTIONS"])
def send_otp():
    return dispatch("send_otp")


@app.route("/api/verify-otp.php", methods=["POST", "OPTIONS"])
@app.route("/api/verify-otp", methods=["POST", "OPTIONS"])
@app.route("/verify-otp.php", methods=["POST", "OPTIONS"])
@app.route("/verify-otp", methods=["POST", "OPTIONS"])
def verify_otp():
    return dispatch("verify_otp")


@app.route("/api/submit-contact-message.php", methods=["POST", "OPTIONS"])
@app.route("/api/submit-contact-message", methods=["POST", "OPTIONS"])
@app.route("/submit-contact-message.php", methods=["POST", "OPTIONS"])
@app.route("/submit-contact-message", methods=["POST", "OPTIONS"])
def submit_contact_message():
    return dispatch("submit_contact_message")


@app.route("/api/send-contact-reply.php", methods=["POST", "OPTIONS"])
@app.route("/api/send-contact-reply", methods=["POST", "OPTIONS"])
@app.route("/send-contact-reply.php", methods=["POST", "OPTIONS"])
@app.route("/send-contact-reply", methods=["POST", "OPTIONS"])
def send_contact_reply():
    return dispatch("send_contact_reply")


@app.get("/api/health")
@app.get("/health")
def health():
    return send_json({"ok": True, "message": "Elenest Python API is running."})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)
