"""
JWT consent token service.

Each time a user gives consent (Gate 1, Gate 2 auto-approve, Gate 4, Gate 3),
a signed JWT is generated that binds that specific consent to the transaction.

Token payload:
{
    "session_id": str,
    "gate": str,
    "amount": float,
    "product_ids": list[str],
    "decision": str,
    "iat": int,
    "exp": int
}

This gives verifiable, tamper-evident proof of consent — not just a boolean flag.
"""
import time
from typing import Optional
import jwt
from app.config import get_settings

settings = get_settings()


def generate_consent_token(
    session_id: str,
    gate: str,
    amount: float,
    product_ids: list[str],
    decision: str,
) -> str:
    """
    Generate a signed JWT consent token for a specific gate decision.

    Args:
        session_id: The session this consent belongs to
        gate: Which gate fired (gate1, gate2, gate4, gate3)
        amount: The transaction amount the user is consenting to
        product_ids: The products in the cart at time of consent
        decision: "approved" | "abandoned" | "retry"

    Returns:
        Signed JWT string — store this alongside the audit log row
    """
    now = int(time.time())
    payload = {
        "session_id": session_id,
        "gate": gate,
        "amount": amount,
        "product_ids": product_ids,
        "decision": decision,
        "iat": now,
        "exp": now + (settings.JWT_EXPIRE_MINUTES * 60),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token


def verify_consent_token(token: str) -> Optional[dict]:
    """
    Verify and decode a consent JWT token.

    Returns the payload dict if valid, None if expired or tampered.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_consent_token_summary(token: str) -> str:
    """
    Get a human-readable summary of what a consent token covers.
    Used for audit log display.
    """
    payload = verify_consent_token(token)
    if not payload:
        return "expired or invalid token"
    return (
        f"Gate {payload['gate']}: {payload['decision']} "
        f"for ₹{payload['amount']} "
        f"({', '.join(payload['product_ids'])})"
    )
