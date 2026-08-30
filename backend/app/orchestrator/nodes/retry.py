"""
Retry node — publishes a retry job to RabbitMQ and increments retry_count.
The actual retry payment is handled by the RabbitMQ consumer calling back into payment_node.
"""
from app.services.rabbitmq_client import publish_retry_job
from app.services.groq_client import generate_reason
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


def _get_cart_total(cart: list[dict]) -> float:
    return sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)


async def retry_node(state: dict) -> dict:
    """
    Node: retry

    Pushes the payment retry job to RabbitMQ and increments retry_count.
    The RabbitMQ consumer will call back into the payment flow.
    After publishing, the node routes back to payment_node for the actual retry.
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])
    total = _get_cart_total(cart)
    retry_count = state.get("retry_count", 0)
    new_retry_count = retry_count + 1

    logger.info(
        "retry_node_start",
        session_id=session_id,
        retry_count=new_retry_count,
        amount=total,
    )

    # Publish to RabbitMQ
    await publish_retry_job(
        session_id=session_id,
        cart=cart,
        retry_count=new_retry_count,
        amount=total,
    )

    # Audit log for the retry push
    reason = await generate_reason({
        "gate": "retry",
        "decision": "queued",
        "retry_count": new_retry_count,
        "amount": total,
        "extra": f"Retry attempt #{new_retry_count} queued in RabbitMQ for processing",
    })

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="retry",
            decision=f"retry_queued_{new_retry_count}",
            reason=reason,
            amount=total,
            metadata={"retry_count": new_retry_count},
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    return {
        "retry_count": new_retry_count,
        "current_gate": "payment",
        "pending_gate": None,
        "audit_trail": trail,
        # Clear the gate3 consent so it can fire again if this retry also fails
        "consent_history": [
            c for c in state.get("consent_history", [])
            if c.get("gate") != "gate3"
        ],
    }
