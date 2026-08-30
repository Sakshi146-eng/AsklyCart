"""
Consent router — receives user Yes/No decisions at each gate.
Resumes the LangGraph flow with the user's decision injected into consent_history.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal, Optional
from app.services.redis_client import get_session_state, set_session_state, record_consent
from app.services.jwt_service import generate_consent_token
from app.orchestrator.graph import run_session
from app.config import get_settings
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/api", tags=["consent"])
settings = get_settings()


class ConsentRequest(BaseModel):
    session_id: str
    gate: str   # gate1, gate2, gate4, gate3, crosssell
    decision: Literal["yes", "no"]
    # For crosssell: which suggestion was accepted (if yes)
    crosssell_product_id: Optional[str] = None


class ConsentResponse(BaseModel):
    session_id: str
    gate: str
    decision: str
    status: str
    current_gate: Optional[str]
    pending_gate: Optional[str]
    gate_prompt: Optional[str]
    cart: list
    cart_total: float
    terminal_status: Optional[str]
    report_text: Optional[str]
    error_message: Optional[str] = None
    retry_count: int = 0
    cross_sell_suggestions: list


@router.post("/consent", response_model=ConsentResponse)
async def submit_consent(body: ConsentRequest):
    """
    Submit a user's Yes/No decision at a gate.
    Injects the decision into consent_history and resumes the LangGraph flow.
    """
    state = await get_session_state(body.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")

    # Validate the session is waiting at the correct gate
    pending = state.get("pending_gate")
    if pending and pending != body.gate:
        raise HTTPException(
            status_code=400,
            detail=f"Session is waiting at gate '{pending}', not '{body.gate}'"
        )

    # Handle cross-sell acceptance — add the product to cart
    cart = list(state.get("cart", []))
    if body.gate == "crosssell" and body.decision == "yes" and body.crosssell_product_id:
        suggestions = state.get("cross_sell_suggestions", [])
        accepted_suggestion = next(
            (s for s in suggestions if s["product"]["id"] == body.crosssell_product_id),
            None
        )
        if accepted_suggestion:
            product = accepted_suggestion["product"]
            # If combo discount, use combo price
            if accepted_suggestion.get("combo_price"):
                # Replace cart with the combo
                primary = cart[0] if cart else None
                cart = []
                if primary:
                    cart.append({**primary, "price": 0})  # bundled price applied below
                cart.append({
                    "id": product["id"],
                    "name": f"[Combo] {accepted_suggestion.get('combo_label', product['name'])}",
                    "price": float(accepted_suggestion["combo_price"]),
                    "category": product.get("category", ""),
                    "stock": product.get("stock", 0),
                    "description": product.get("description", ""),
                    "quantity": 1,
                })
                # Remove the zero-price placeholder — just use the combo item
                cart = [item for item in cart if item.get("price", 0) > 0]
            else:
                # Add as separate item
                existing_ids = {item["id"] for item in cart}
                if product["id"] not in existing_ids:
                    cart.append({
                        "id": product["id"],
                        "name": product["name"],
                        "price": float(product["price"]),
                        "category": product.get("category", ""),
                        "stock": product.get("stock", 0),
                        "description": product.get("description", ""),
                        "quantity": 1,
                    })

        state["cart"] = cart
        state["cross_sell_accepted"] = True

    # Inject user's gate decision into consent_history
    consent_history = list(state.get("consent_history", []))
    # Remove any existing entry for this gate to avoid conflicts
    consent_history = [c for c in consent_history if c.get("gate") != body.gate]

    cart_total = sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)
    token = generate_consent_token(
        session_id=body.session_id,
        gate=body.gate,
        amount=cart_total,
        product_ids=[item["id"] for item in cart],
        decision=body.decision,
    )

    consent_history.append({
        "gate": body.gate,
        "decision": body.decision,
        "token": token,
    })
    state["consent_history"] = consent_history
    state["pending_gate"] = None
    state["cart"] = cart

    # Save updated state to Redis
    await set_session_state(body.session_id, state)

    # Resume the LangGraph flow with updated state
    try:
        result = await run_session(state, thread_id=body.session_id)
        merged = {**state, **result}
        await set_session_state(body.session_id, merged)
    except Exception as e:
        logger.error("consent_resume_error", error=str(e), session_id=body.session_id)
        raise HTTPException(status_code=500, detail=f"Agent error resuming flow: {str(e)}")

    final_cart = result.get("cart", cart)
    final_total = sum(item.get("price", 0) * item.get("quantity", 1) for item in final_cart)

    return ConsentResponse(
        session_id=body.session_id,
        gate=body.gate,
        decision=body.decision,
        status=result.get("terminal_status") or "in_progress",
        current_gate=result.get("current_gate"),
        pending_gate=result.get("pending_gate"),
        gate_prompt=result.get("gate_prompt"),
        cart=final_cart,
        cart_total=final_total,
        terminal_status=result.get("terminal_status"),
        report_text=result.get("report_text"),
        error_message=result.get("error_message"),
        retry_count=result.get("retry_count", 0),
        cross_sell_suggestions=result.get("cross_sell_suggestions", []),
    )
