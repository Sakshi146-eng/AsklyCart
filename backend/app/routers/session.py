"""
Session router — creates new sessions and returns status.
"""
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from app.config import get_settings
from app.services.redis_client import set_session_state, get_session_state
from app.db.database import AsyncSessionLocal
from sqlalchemy import text

router = APIRouter(prefix="/api", tags=["session"])
settings = get_settings()


class CreateSessionRequest(BaseModel):
    user_email: Optional[str] = None
    spending_cap: Optional[float] = None


class SessionResponse(BaseModel):
    session_id: str
    spending_cap: float
    status: str
    created_at: str


@router.post("/session", response_model=SessionResponse)
async def create_session(body: CreateSessionRequest):
    """Create a new shopping session."""
    session_id = str(uuid.uuid4())
    spending_cap = body.spending_cap or settings.DEFAULT_SPENDING_CAP
    now = datetime.utcnow().isoformat()

    # Store in Redis
    await set_session_state(session_id, {
        "session_id": session_id,
        "user_email": body.user_email,
        "spending_cap": spending_cap,
        "cart": [],
        "consent_history": [],
        "retry_count": 0,
        "current_gate": None,
        "audit_trail": [],
        "created_at": now,
    })

    # Store in Postgres
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO sessions (session_id, user_email, spending_cap, status, created_at, updated_at)
                VALUES (:session_id, :user_email, :spending_cap, 'active', NOW(), NOW())
                ON CONFLICT (session_id) DO NOTHING
            """),
            {
                "session_id": session_id,
                "user_email": body.user_email,
                "spending_cap": spending_cap,
            }
        )
        await db.commit()

    return SessionResponse(
        session_id=session_id,
        spending_cap=spending_cap,
        status="active",
        created_at=now,
    )


@router.get("/session/{session_id}/status")
async def get_session_status(session_id: str):
    """Get current status and gate of a session."""
    state = await get_session_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "current_gate": state.get("current_gate"),
        "pending_gate": state.get("pending_gate"),
        "gate_prompt": state.get("gate_prompt"),
        "cart": state.get("cart", []),
        "cart_total": sum(
            item.get("price", 0) * item.get("quantity", 1)
            for item in state.get("cart", [])
        ),
        "terminal_status": state.get("terminal_status"),
        "error_message": state.get("error_message"),
        "report_text": state.get("report_text"),
        "email_sent": state.get("email_sent", False),
        "retry_count": state.get("retry_count", 0),
        "cross_sell_suggestions": state.get("cross_sell_suggestions", []),
        "cross_sell_shown": state.get("cross_sell_shown", False),
    }
