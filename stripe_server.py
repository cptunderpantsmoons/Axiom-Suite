"""Minimal server-side Stripe subscription integration for the Axiom landing page.

Run locally after installing requirements:
    python3 stripe_server.py

The browser only receives Stripe's hosted Checkout URL. Secret and webhook keys
are read from environment variables and are never sent to the landing page.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import stripe
from flask import Flask, jsonify, request, send_file


BASE_DIR = Path(__file__).resolve().parent
LANDING_PAGE = BASE_DIR / "combined-projects-landing.html"
STORE_CONFIG = Path(os.environ.get("SUBSCRIPTION_STORE_FILE", "data/subscriptions.json"))
STORE_PATH = STORE_CONFIG if STORE_CONFIG.is_absolute() else BASE_DIR / STORE_CONFIG
STORE_LOCK = threading.Lock()

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_PRICE_IDS = {
    "builder": os.environ.get("STRIPE_PRICE_ID_BUILDER", STRIPE_PRICE_ID),
    "team": os.environ.get("STRIPE_PRICE_ID_TEAM", ""),
}
APP_ORIGIN = os.environ.get("APP_ORIGIN", "http://localhost:5000").rstrip("/")

stripe.api_key = STRIPE_SECRET_KEY
app = Flask(__name__)


class ConfigurationError(RuntimeError):
    """Raised when an endpoint cannot run without required configuration."""


def _require_checkout_config(plan: str) -> str:
    if not STRIPE_SECRET_KEY:
        raise ConfigurationError("STRIPE_SECRET_KEY is not configured")
    if not isinstance(plan, str) or plan not in STRIPE_PRICE_IDS:
        raise ConfigurationError("Unknown subscription plan")
    price_id = STRIPE_PRICE_IDS[plan]
    if not price_id:
        raise ConfigurationError(f"Price ID for {plan} is not configured")
    if not APP_ORIGIN.startswith(("http://", "https://")):
        raise ConfigurationError("APP_ORIGIN must start with http:// or https://")
    return price_id


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_store() -> dict[str, Any]:
    if not STORE_PATH.exists():
        return {"subscriptions": {}, "processed_events": {}}
    try:
        with STORE_PATH.open("r", encoding="utf-8") as store_file:
            data = json.load(store_file)
    except (OSError, json.JSONDecodeError):
        app.logger.exception("Unable to read subscription store")
        return {"subscriptions": {}, "processed_events": {}}
    data.setdefault("subscriptions", {})
    data.setdefault("processed_events", {})
    return data


def _write_store(data: dict[str, Any]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=STORE_PATH.parent,
            prefix=f".{STORE_PATH.name}.",
            delete=False,
        ) as temporary_file:
            json.dump(data, temporary_file, indent=2, sort_keys=True)
            temporary_file.write("\n")
            temporary_path = temporary_file.name
        os.replace(temporary_path, STORE_PATH)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)


def _subscription_fields(subscription: Any) -> dict[str, Any]:
    items = subscription.get("items", {}).get("data", [])
    price = items[0].get("price", {}) if items else {}
    return {
        "subscription_id": subscription.get("id"),
        "customer_id": subscription.get("customer"),
        "status": subscription.get("status"),
        "price_id": price.get("id"),
        "plan": price.get("lookup_key") or price.get("id"),
        "current_period_end": subscription.get("current_period_end"),
        "cancel_at_period_end": subscription.get("cancel_at_period_end", False),
        "updated_at": _utc_now(),
    }


def _record_subscription(state: dict[str, Any], subscription_id: str, fields: dict[str, Any]) -> None:
    current = state["subscriptions"].setdefault(subscription_id, {})
    current.update({key: value for key, value in fields.items() if value is not None})


def _apply_event(state: dict[str, Any], event: Any) -> None:
    event_type = event["type"]
    payload = event["data"]["object"]

    if event_type == "checkout.session.completed":
        if payload.get("mode") != "subscription" or not payload.get("subscription"):
            return
        _record_subscription(
            state,
            payload["subscription"],
            {
                "subscription_id": payload["subscription"],
                "customer_id": payload.get("customer"),
                "checkout_status": payload.get("status"),
                "checkout_completed_at": _utc_now(),
                "updated_at": _utc_now(),
            },
        )
        return

    subscription_id = payload.get("id") or payload.get("subscription")
    if not subscription_id:
        return

    if event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        fields = _subscription_fields(payload)
        if event_type == "customer.subscription.deleted":
            fields["status"] = "canceled"
        _record_subscription(state, subscription_id, fields)
    elif event_type == "invoice.paid":
        _record_subscription(
            state,
            subscription_id,
            {"status": "active", "last_invoice_paid_at": _utc_now(), "updated_at": _utc_now()},
        )
    elif event_type == "invoice.payment_failed":
        _record_subscription(
            state,
            subscription_id,
            {"status": "past_due", "last_payment_failed_at": _utc_now(), "updated_at": _utc_now()},
        )


@app.get("/")
def landing_page():
    """Serve the existing landing page from the same origin as Checkout."""
    return send_file(LANDING_PAGE)


@app.post("/create-checkout-session")
def create_checkout_session():
    """Create a hosted Checkout Session for an allowlisted recurring plan."""
    body = request.get_json(silent=True) or {}
    plan = body.get("plan", "team")
    if not isinstance(plan, str) or plan not in STRIPE_PRICE_IDS:
        return jsonify({"error": "Unknown subscription plan"}), 400
    try:
        price_id = _require_checkout_config(plan)
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=(
                f"{APP_ORIGIN}/?checkout=success&session_id={{CHECKOUT_SESSION_ID}}"
            ),
            cancel_url=f"{APP_ORIGIN}/?checkout=cancel",
            allow_promotion_codes=True,
            subscription_data={"metadata": {"product": "axiom", "plan": plan}},
            client_reference_id=f"axiom_{plan}_{uuid4().hex}",
        )
    except ConfigurationError as error:
        return jsonify({"error": str(error)}), 503
    except stripe.error.StripeError:
        app.logger.exception("Stripe Checkout session creation failed")
        return jsonify({"error": "Unable to start checkout right now."}), 502

    return jsonify({"url": session.url})


@app.post("/webhook")
def stripe_webhook():
    """Verify and process Stripe subscription lifecycle events."""
    if not STRIPE_WEBHOOK_SECRET:
        return jsonify({"error": "STRIPE_WEBHOOK_SECRET is not configured"}), 503

    try:
        event = stripe.Webhook.construct_event(
            request.get_data(),
            request.headers.get("Stripe-Signature", ""),
            STRIPE_WEBHOOK_SECRET,
        )
    except ValueError:
        return jsonify({"error": "Invalid webhook payload"}), 400
    except stripe.error.SignatureVerificationError:
        return jsonify({"error": "Invalid webhook signature"}), 400

    event_id = event["id"]
    with STORE_LOCK:
        state = _read_store()
        if event_id in state["processed_events"]:
            return jsonify({"received": True, "duplicate": True})
        _apply_event(state, event)
        state["processed_events"][event_id] = {"type": event["type"], "processed_at": _utc_now()}
        # Keep the local idempotency record bounded for this lightweight starter.
        state["processed_events"] = dict(list(state["processed_events"].items())[-1000:])
        _write_store(state)

    return jsonify({"received": True})


@app.get("/health")
def health_check():
    """Expose configuration status without returning any secret values."""
    return jsonify(
        {
            "status": "healthy",
            "stripe_secret_configured": bool(STRIPE_SECRET_KEY),
            "stripe_price_configured": {
                "builder": bool(STRIPE_PRICE_IDS["builder"]),
                "team": bool(STRIPE_PRICE_IDS["team"]),
            },
            "webhook_secret_configured": bool(STRIPE_WEBHOOK_SECRET),
        }
    )


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
