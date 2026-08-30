"""
Gate nodes — Gate 1, Gate 2, Gate 4, Gate 3.

Each gate:
1. Uses Model B to generate a human-readable "why" explanation
2. Writes one row to audit_log with that reason
3. Generates a JWT consent token binding the decision to the transaction
4. Returns updated state

Gate decisions (Yes/No) come from the state via the consent API —
the gate nodes read state["consent_history"] to know what the user answered.
"""
from datetime import datetime
from app.services.groq_client import generate_reason
from app.services.jwt_service import generate_consent_token
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


def _get_cart_total(cart: list[dict]) -> float:
    return sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)


def _get_product_ids(cart: list[dict]) -> list[str]:
    return [item["id"] for item in cart]


def _get_latest_consent(state: dict, gate: str) -> str | None:
    """Get the user's answer for a specific gate from consent history."""
    history = state.get("consent_history", [])
    for record in reversed(history):
        if record.get("gate") == gate:
            return record.get("decision")
    return None


# ─────────────────────────────────────────────────────────────
# Gate 1 — Interest Check
# ─────────────────────────────────────────────────────────────

async def gate1_node(state: dict) -> dict:
    """
    Gate 1: Ask if the user is interested in the shortlisted product.
    - YES → proceed to gate2
    - NO  → log as abandoned, terminal state
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])
    total = _get_cart_total(cart)

    # Check for user's answer
    user_answer = _get_latest_consent(state, "gate1")

    if user_answer is None:
        # No answer yet — pause and wait for user input
        product_names = ", ".join(item["name"] for item in cart)
        gate_prompt = (
            f"Your cart: {product_names} (Total: ₹{total:.0f}). "
            f"Would you like to proceed with purchasing this?"
        )
        return {
            "pending_gate": "gate1",
            "gate_prompt": gate_prompt,
            "current_gate": "gate1",
            "audit_trail": state.get("audit_trail", []),
        }

    # User answered — process the decision
    decision = "interested" if user_answer == "yes" else "not_interested"

    reason = await generate_reason({
        "gate": "gate1",
        "decision": decision,
        "product_names": [item["name"] for item in cart],
        "amount": total,
        "extra": "User confirmed interest" if user_answer == "yes" else "User declined — marking as abandoned",
    })

    token = generate_consent_token(
        session_id=session_id,
        gate="gate1",
        amount=total,
        product_ids=_get_product_ids(cart),
        decision=decision,
    )

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="gate1",
            decision=decision,
            reason=reason,
            amount=total,
            consent_token=token,
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    if user_answer == "yes":
        return {
            "pending_gate": None,
            "current_gate": "gate2",
            "audit_trail": trail,
            "terminal_status": None,
        }
    else:
        return {
            "pending_gate": None,
            "current_gate": "end",
            "terminal_status": "abandoned",
            "audit_trail": trail,
        }


# ─────────────────────────────────────────────────────────────
# Gate 2 — Price vs. Spending Cap
# ─────────────────────────────────────────────────────────────

async def gate2_node(state: dict) -> dict:
    """
    Gate 2: Check product price against spending cap.
    - Price ≤ cap → auto-approved, proceed to payment (no user prompt needed)
    - Price > cap → go to Gate 4 for explicit over-cap consent
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])
    spending_cap = state.get("spending_cap", 2000.0)
    total = _get_cart_total(cart)

    if total <= spending_cap:
        decision = "auto_approved"
        reason = await generate_reason({
            "gate": "gate2",
            "decision": "auto_approved",
            "amount": total,
            "cap": spending_cap,
            "extra": f"₹{total:.0f} is within the ₹{spending_cap:.0f} auto-approve cap",
        })

        token = generate_consent_token(
            session_id=session_id,
            gate="gate2",
            amount=total,
            product_ids=_get_product_ids(cart),
            decision="auto_approved",
        )

        async with AsyncSessionLocal() as db:
            audit_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="gate2",
                decision="auto_approved",
                reason=reason,
                amount=total,
                consent_token=token,
            )

        trail = list(state.get("audit_trail", []))
        trail.append(audit_entry)

        return {
            "pending_gate": None,
            "current_gate": "payment",
            "audit_trail": trail,
        }

    else:
        # Over cap — escalate to Gate 4
        decision = "escalated_to_gate4"
        reason = await generate_reason({
            "gate": "gate2",
            "decision": "escalated",
            "amount": total,
            "cap": spending_cap,
            "extra": f"₹{total:.0f} exceeds the ₹{spending_cap:.0f} auto-approve cap — escalating to user consent",
        })

        async with AsyncSessionLocal() as db:
            audit_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="gate2",
                decision="escalated_to_gate4",
                reason=reason,
                amount=total,
            )

        trail = list(state.get("audit_trail", []))
        trail.append(audit_entry)

        return {
            "pending_gate": None,
            "current_gate": "gate4",
            "audit_trail": trail,
        }


# ─────────────────────────────────────────────────────────────
# Gate 4 — Over-cap Consent
# ─────────────────────────────────────────────────────────────

async def gate4_node(state: dict) -> dict:
    """
    Gate 4: Explicit user consent for purchases above the auto-approve cap.
    - YES → proceed to payment
    - NO  → log as abandoned (terminal state)
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])
    spending_cap = state.get("spending_cap", 2000.0)
    total = _get_cart_total(cart)

    user_answer = _get_latest_consent(state, "gate4")

    if user_answer is None:
        gate_prompt = (
            f"⚠️ This purchase (₹{total:.0f}) exceeds your auto-approve limit of ₹{spending_cap:.0f}. "
            f"Do you explicitly authorize this transaction?"
        )
        return {
            "pending_gate": "gate4",
            "gate_prompt": gate_prompt,
            "current_gate": "gate4",
            "audit_trail": state.get("audit_trail", []),
        }

    decision = "over_cap_approved" if user_answer == "yes" else "over_cap_declined"

    reason = await generate_reason({
        "gate": "gate4",
        "decision": decision,
        "amount": total,
        "cap": spending_cap,
        "extra": (
            f"User explicitly authorized ₹{total:.0f} above the ₹{spending_cap:.0f} cap"
            if user_answer == "yes"
            else f"User declined to authorize ₹{total:.0f} over-cap purchase — abandoned"
        ),
    })

    token = generate_consent_token(
        session_id=session_id,
        gate="gate4",
        amount=total,
        product_ids=_get_product_ids(cart),
        decision=decision,
    )

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="gate4",
            decision=decision,
            reason=reason,
            amount=total,
            consent_token=token,
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    if user_answer == "yes":
        return {
            "pending_gate": None,
            "current_gate": "payment",
            "audit_trail": trail,
            "terminal_status": None,
        }
    else:
        return {
            "pending_gate": None,
            "current_gate": "end",
            "terminal_status": "abandoned",
            "audit_trail": trail,
        }


# ─────────────────────────────────────────────────────────────
# Gate 3 — Retry Consent (after payment failure)
# ─────────────────────────────────────────────────────────────

async def gate3_node(state: dict) -> dict:
    """
    Gate 3: After a payment failure, ask if the user wants to retry.
    - YES (and retry_count < MAX) → push to RabbitMQ retry queue
    - YES (and retry_count >= MAX) → stop, log terminal failure
    - NO  → log as failed, terminal state

    MAX_RETRY_ATTEMPTS = 2 (configurable via settings)
    """
    from app.config import get_settings
    settings = get_settings()

    session_id = state["session_id"]
    cart = state.get("cart", [])
    total = _get_cart_total(cart)
    retry_count = state.get("retry_count", 0)
    payment_result = state.get("payment_result", {})
    error_msg = payment_result.get("error", "Unknown error") if payment_result else "Unknown error"

    user_answer = _get_latest_consent(state, "gate3")

    # Check if we've hit the retry cap
    if retry_count >= settings.MAX_RETRY_ATTEMPTS:
        # Auto-stop: exceeded retry cap
        reason = await generate_reason({
            "gate": "gate3",
            "decision": "max_retries_exceeded",
            "retry_count": retry_count,
            "max_retries": settings.MAX_RETRY_ATTEMPTS,
            "amount": total,
            "extra": f"Automatically stopped after {retry_count} failed retry attempts",
        })

        async with AsyncSessionLocal() as db:
            audit_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="gate3",
                decision="max_retries_exceeded",
                reason=reason,
                amount=total,
            )

        async with AsyncSessionLocal() as db:
            final_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="final_status",
                decision="failed",
                reason=f"Payment failed after {retry_count} retry attempts. Terminal failure.",
                amount=total,
            )

        trail = list(state.get("audit_trail", []))
        trail.extend([audit_entry, final_entry])

        return {
            "pending_gate": None,
            "current_gate": "end",
            "terminal_status": "failed",
            "error_message": f"Payment failed after {retry_count} retries. Maximum retry limit reached.",
            "audit_trail": trail,
        }

    if user_answer is None:
        gate_prompt = (
            f"❌ Payment failed: {error_msg}. "
            f"Would you like to retry? "
            f"({settings.MAX_RETRY_ATTEMPTS - retry_count} attempts remaining)"
        )
        return {
            "pending_gate": "gate3",
            "gate_prompt": gate_prompt,
            "current_gate": "gate3",
            "audit_trail": state.get("audit_trail", []),
        }

    decision = "retry_requested" if user_answer == "yes" else "retry_declined"

    reason = await generate_reason({
        "gate": "gate3",
        "decision": decision,
        "retry_count": retry_count,
        "max_retries": settings.MAX_RETRY_ATTEMPTS,
        "amount": total,
        "error": error_msg,
        "extra": (
            f"User requested retry #{retry_count + 1} of {settings.MAX_RETRY_ATTEMPTS}"
            if user_answer == "yes"
            else "User declined to retry — marking as permanently failed"
        ),
    })

    token = generate_consent_token(
        session_id=session_id,
        gate="gate3",
        amount=total,
        product_ids=_get_product_ids(cart),
        decision=decision,
    )

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="gate3",
            decision=decision,
            reason=reason,
            amount=total,
            consent_token=token,
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    if user_answer == "yes":
        return {
            "pending_gate": None,
            "current_gate": "retry",
            "audit_trail": trail,
        }
    else:
        # Terminal failure
        async with AsyncSessionLocal() as db:
            final_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="final_status",
                decision="failed",
                reason="User declined retry — transaction permanently failed.",
                amount=total,
            )
        trail.append(final_entry)

        return {
            "pending_gate": None,
            "current_gate": "end",
            "terminal_status": "failed",
            "error_message": "User declined retry. Transaction failed.",
            "audit_trail": trail,
        }
