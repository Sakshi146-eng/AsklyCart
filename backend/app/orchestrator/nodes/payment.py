"""
Payment node — calls Razorpay test-mode API and routes to report (success) or gate3 (failure).
"""
from app.services.razorpay_client import create_order, simulate_payment_capture
from app.services.groq_client import generate_reason
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


def _get_cart_total(cart: list[dict]) -> float:
    return sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)


async def payment_node(state: dict) -> dict:
    """
    Node: payment
    1. Call Razorpay test-mode order creation
    2. Simulate payment capture
    3. Write audit log entry (success or failure)
    4. Route: success → report, failure → gate3
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])
    total = _get_cart_total(cart)
    retry_count = state.get("retry_count", 0)

    logger.info("payment_node_start", session_id=session_id, amount=total, attempt=retry_count + 1)

    # Step 1: Create Razorpay order
    order_result = await create_order(amount_inr=total, session_id=session_id)

    if not order_result["success"]:
        # Payment failed
        reason = await generate_reason({
            "gate": "payment_attempt",
            "decision": "failed",
            "amount": total,
            "attempt": retry_count + 1,
            "error": order_result.get("error", "Unknown error"),
        })

        async with AsyncSessionLocal() as db:
            audit_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="payment_attempt",
                decision="failed",
                reason=reason,
                amount=total,
                metadata={"error": order_result.get("error"), "attempt": retry_count + 1},
            )

        trail = list(state.get("audit_trail", []))
        trail.append(audit_entry)

        return {
            "payment_result": order_result,
            "current_gate": "gate3",
            "audit_trail": trail,
        }

    # Step 2: Simulate payment capture
    capture_result = await simulate_payment_capture(
        order_id=order_result["order_id"],
        amount_inr=total,
    )

    if not capture_result["success"]:
        reason = await generate_reason({
            "gate": "payment_attempt",
            "decision": "capture_failed",
            "amount": total,
            "order_id": order_result["order_id"],
            "error": capture_result.get("error"),
        })

        async with AsyncSessionLocal() as db:
            audit_entry = await write_audit_log(
                db=db,
                session_id=session_id,
                step="payment_attempt",
                decision="capture_failed",
                reason=reason,
                amount=total,
                metadata={"order_id": order_result["order_id"], "error": capture_result.get("error")},
            )

        trail = list(state.get("audit_trail", []))
        trail.append(audit_entry)

        combined_result = {**order_result, **capture_result}
        return {
            "payment_result": combined_result,
            "current_gate": "gate3",
            "audit_trail": trail,
        }

    # Payment SUCCESS
    reason = await generate_reason({
        "gate": "payment_attempt",
        "decision": "success",
        "amount": total,
        "order_id": order_result["order_id"],
        "payment_id": capture_result.get("payment_id"),
    })

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="payment_attempt",
            decision="success",
            reason=reason,
            amount=total,
            metadata={
                "order_id": order_result["order_id"],
                "payment_id": capture_result.get("payment_id"),
            },
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    combined_result = {**order_result, **capture_result}

    logger.info(
        "payment_success",
        session_id=session_id,
        order_id=order_result["order_id"],
        amount=total,
    )

    return {
        "payment_result": combined_result,
        "order_id": order_result["order_id"],
        "payment_id": capture_result.get("payment_id"),
        "current_gate": "report",
        "audit_trail": trail,
    }
