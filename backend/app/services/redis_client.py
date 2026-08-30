"""
Redis client for session/cart state management.
Stores per-session cart contents and in-progress consent state.
"""
import json
from typing import Optional, Any
import redis.asyncio as aioredis
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

_redis_client: Optional[aioredis.Redis] = None

SESSION_TTL = 3600  # 1 hour


async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_redis():
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None


# ─────────────────────────────────────────────────────────────
# Session State
# ─────────────────────────────────────────────────────────────

async def set_session_state(session_id: str, state: dict):
    """Store the full session state in Redis."""
    redis = await get_redis()
    key = f"session:{session_id}:state"
    await redis.setex(key, SESSION_TTL, json.dumps(state))


async def get_session_state(session_id: str) -> Optional[dict]:
    """Retrieve full session state from Redis."""
    redis = await get_redis()
    key = f"session:{session_id}:state"
    data = await redis.get(key)
    if data:
        return json.loads(data)
    return None


async def delete_session_state(session_id: str):
    """Remove session state from Redis."""
    redis = await get_redis()
    key = f"session:{session_id}:state"
    await redis.delete(key)


# ─────────────────────────────────────────────────────────────
# Cart Operations
# ─────────────────────────────────────────────────────────────

async def get_cart(session_id: str) -> list[dict]:
    """Get cart items for a session."""
    state = await get_session_state(session_id)
    if state:
        return state.get("cart", [])
    return []


async def add_to_cart(session_id: str, product: dict):
    """Add a product to the session cart."""
    state = await get_session_state(session_id) or {}
    cart = state.get("cart", [])

    # Check if product already in cart
    existing = next((item for item in cart if item["id"] == product["id"]), None)
    if existing:
        existing["quantity"] = existing.get("quantity", 1) + 1
    else:
        cart.append({**product, "quantity": 1})

    state["cart"] = cart
    await set_session_state(session_id, state)
    return cart


async def clear_cart(session_id: str):
    """Clear all items from cart."""
    state = await get_session_state(session_id) or {}
    state["cart"] = []
    await set_session_state(session_id, state)


# ─────────────────────────────────────────────────────────────
# Gate / Consent State
# ─────────────────────────────────────────────────────────────

async def set_current_gate(session_id: str, gate: str):
    """Update which gate the session is currently at."""
    state = await get_session_state(session_id) or {}
    state["current_gate"] = gate
    await set_session_state(session_id, state)


async def get_current_gate(session_id: str) -> Optional[str]:
    """Get the current gate for a session."""
    state = await get_session_state(session_id) or {}
    return state.get("current_gate")


async def record_consent(session_id: str, gate: str, decision: str, token: str):
    """Record a consent decision for a gate."""
    state = await get_session_state(session_id) or {}
    consent_history = state.get("consent_history", [])
    consent_history.append({
        "gate": gate,
        "decision": decision,
        "token": token,
    })
    state["consent_history"] = consent_history
    await set_session_state(session_id, state)


async def get_retry_count(session_id: str) -> int:
    """Get the current retry count for a session."""
    state = await get_session_state(session_id) or {}
    return state.get("retry_count", 0)


async def increment_retry_count(session_id: str) -> int:
    """Increment and return the retry count."""
    state = await get_session_state(session_id) or {}
    count = state.get("retry_count", 0) + 1
    state["retry_count"] = count
    await set_session_state(session_id, state)
    return count
