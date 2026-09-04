"""
Auth router — user registration, login, and token-protected /me endpoint.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
import uuid
from sqlalchemy import text

import jwt

from app.db.database import AsyncSessionLocal
from app.services.auth_service import hash_password, verify_password, create_access_token, decode_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)


# ── Pydantic schemas ──────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    spending_cap: Optional[float] = 2000.0


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    spending_cap: float
    created_at: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut


# ── Auth dependency ───────────────────────────────────────────────────────

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> dict:
    """Validate Bearer token and return the user row as a dict."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("SELECT id, name, email, spending_cap, created_at FROM users WHERE id = :id"),
            {"id": user_id},
        )
        user = row.mappings().first()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(user)


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest):
    """Create a new user account."""
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    async with AsyncSessionLocal() as db:
        # Check duplicate email
        exists = await db.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": body.email.lower()},
        )
        if exists.first():
            raise HTTPException(status_code=409, detail="Email already registered")

        user_id = str(uuid.uuid4())
        pwd_hash = hash_password(body.password)

        await db.execute(
            text("""
                INSERT INTO users (id, name, email, password_hash, spending_cap, created_at, updated_at)
                VALUES (:id, :name, :email, :password_hash, :spending_cap, NOW(), NOW())
            """),
            {
                "id": user_id,
                "name": body.name.strip(),
                "email": body.email.lower(),
                "password_hash": pwd_hash,
                "spending_cap": body.spending_cap or 2000.0,
            },
        )
        await db.commit()

        # Fetch back for response
        row = await db.execute(
            text("SELECT id, name, email, spending_cap, created_at FROM users WHERE id = :id"),
            {"id": user_id},
        )
        user = dict(row.mappings().first())

    token = create_access_token(user_id)
    return AuthResponse(
        token=token,
        user=UserOut(
            id=str(user["id"]),
            name=user["name"],
            email=user["email"],
            spending_cap=float(user["spending_cap"]),
            created_at=str(user["created_at"]),
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest):
    """Authenticate and return a JWT."""
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("SELECT id, name, email, password_hash, spending_cap, created_at FROM users WHERE email = :email"),
            {"email": body.email.lower()},
        )
        user = row.mappings().first()

    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(str(user["id"]))
    return AuthResponse(
        token=token,
        user=UserOut(
            id=str(user["id"]),
            name=user["name"],
            email=user["email"],
            spending_cap=float(user["spending_cap"]),
            created_at=str(user["created_at"]),
        ),
    )


@router.get("/me", response_model=UserOut)
async def me(current_user: dict = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return UserOut(
        id=str(current_user["id"]),
        name=current_user["name"],
        email=current_user["email"],
        spending_cap=float(current_user["spending_cap"]),
        created_at=str(current_user["created_at"]),
    )


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update name or spending_cap for the authenticated user."""
    allowed = {}
    if "name" in body and body["name"]:
        allowed["name"] = body["name"].strip()
    if "spending_cap" in body and body["spending_cap"] is not None:
        allowed["spending_cap"] = float(body["spending_cap"])

    if not allowed:
        raise HTTPException(status_code=400, detail="Nothing to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in allowed)
    allowed["id"] = str(current_user["id"])

    async with AsyncSessionLocal() as db:
        await db.execute(
            text(f"UPDATE users SET {set_clause}, updated_at = NOW() WHERE id = :id"),
            allowed,
        )
        await db.commit()
        row = await db.execute(
            text("SELECT id, name, email, spending_cap, created_at FROM users WHERE id = :id"),
            {"id": str(current_user["id"])},
        )
        user = dict(row.mappings().first())

    return UserOut(
        id=str(user["id"]),
        name=user["name"],
        email=user["email"],
        spending_cap=float(user["spending_cap"]),
        created_at=str(user["created_at"]),
    )
