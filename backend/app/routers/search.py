"""
Search router — triggers the LangGraph orchestrator with a search query.
"""
import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from app.orchestrator.graph import run_session, get_session_snapshot
from app.services.redis_client import get_session_state, set_session_state
from app.config import get_settings

router = APIRouter(prefix="/api", tags=["search"])
settings = get_settings()

# Track running sessions (in-memory for Phase 1; use Redis/DB for production)
_running_sessions: dict = {}


class SearchRequest(BaseModel):
    session_id: str
    query: str


class SearchResponse(BaseModel):
    session_id: str
    status: str
    search_results: list
    current_gate: Optional[str]
    pending_gate: Optional[str]
    gate_prompt: Optional[str]
    cross_sell_suggestions: list
    cart: list
    # Terminal fields — populated when the agent completes without pausing
    terminal_status: Optional[str] = None
    error_message: Optional[str] = None
    report_text: Optional[str] = None
    retry_count: int = 0


@router.post("/search", response_model=SearchResponse)
async def search(body: SearchRequest, background_tasks: BackgroundTasks):
    """
    Trigger a search and start the agent flow.
    The agent runs through search → cart → crosssell → gate1 (first gate requiring user input).
    Returns the state after reaching the first gate.
    """
    # Validate session exists
    state = await get_session_state(body.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found. Call POST /api/session first.")

    # Check if session already has an active flow
    if body.session_id in _running_sessions:
        raise HTTPException(status_code=409, detail="Session already has an active flow")

    # Build initial LangGraph state
    initial_state = {
        "session_id": body.session_id,
        "user_email": state.get("user_email"),
        "query": body.query,
        "parsed_query": {},
        "search_results": [],
        "cart": state.get("cart", []),
        "spending_cap": state.get("spending_cap", settings.DEFAULT_SPENDING_CAP),
        "cross_sell_suggestions": [],
        "cross_sell_shown": False,
        "cross_sell_accepted": False,
        "current_gate": "search",
        "consent_history": state.get("consent_history", []),
        "payment_result": None,
        "retry_count": state.get("retry_count", 0),
        "order_id": None,
        "payment_id": None,
        "report_text": None,
        "email_sent": False,
        "audit_trail": state.get("audit_trail", []),
        "terminal_status": None,
        "error_message": None,
        "pending_gate": None,
        "gate_prompt": None,
    }

    _running_sessions[body.session_id] = True

    try:
        # Run the graph — it will pause at the first gate needing user input
        result = await run_session(initial_state, thread_id=body.session_id)

        # Persist result back to Redis for status polling
        merged_state = {**state, **result}
        await set_session_state(body.session_id, merged_state)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")
    finally:
        _running_sessions.pop(body.session_id, None)

    return SearchResponse(
        session_id=body.session_id,
        status=result.get("terminal_status") or "in_progress",
        search_results=result.get("search_results", []),
        current_gate=result.get("current_gate"),
        pending_gate=result.get("pending_gate"),
        gate_prompt=result.get("gate_prompt"),
        cross_sell_suggestions=result.get("cross_sell_suggestions", []),
        cart=result.get("cart", []),
        terminal_status=result.get("terminal_status"),
        error_message=result.get("error_message"),
        report_text=result.get("report_text"),
        retry_count=result.get("retry_count", 0),
    )
