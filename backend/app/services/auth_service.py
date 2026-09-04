"""
Auth service — password hashing (stdlib PBKDF2) + JWT encode/decode (PyJWT).
No third-party auth library required beyond PyJWT which is already installed.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings

settings = get_settings()

# Use SECRET_KEY as JWT signing key (already set in config; users should override in .env)
_JWT_KEY = settings.SECRET_KEY
_ALGORITHM = settings.JWT_ALGORITHM
_EXPIRE_DAYS = 30  # Long-lived tokens for demo convenience


# ── Password ───────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Return '{salt}:{pbkdf2_hex}' — safe to store in DB."""
    salt = secrets.token_hex(32)
    key = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260_000)
    return f"{salt}:{key.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    try:
        salt, key_hex = stored.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260_000)
        return hmac.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


# ── JWT ────────────────────────────────────────────────────────────────────

def create_access_token(user_id: str) -> str:
    """Create a signed JWT containing the user_id as 'sub'."""
    payload = {
        "sub": str(user_id),
        "iat": datetime.now(tz=timezone.utc),
        "exp": datetime.now(tz=timezone.utc) + timedelta(days=_EXPIRE_DAYS),
    }
    return jwt.encode(payload, _JWT_KEY, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> str:
    """Decode JWT and return user_id string. Raises jwt.PyJWTError on failure."""
    payload = jwt.decode(token, _JWT_KEY, algorithms=[_ALGORITHM])
    return payload["sub"]
