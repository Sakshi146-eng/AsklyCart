"""
Report node — generates receipt using Model B, sends email, writes final audit entry.
"""
from app.services.groq_client import generate_report
from app.services.email_service import send_receipt_email
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


async def report_node(state: dict) -> dict:
    """
    Node: report

    On successful payment:
    1. Model B reads the full audit trail and produces a human-readable summary
    2. Email the summary as a styled receipt to the user
    3. Write final_status = "completed" to audit log
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])
    audit_trail = state.get("audit_trail", [])
    order_id = state.get("order_id")
    payment_id = state.get("payment_id")
    user_email = state.get("user_email")

    logger.info("report_node_start", session_id=session_id, order_id=order_id)

    # Step 1: Model B generates receipt narrative
    report_text = await generate_report(
        session_id=session_id,
        audit_trail=audit_trail,
        cart=cart,
    )

    # Step 2: Send email if we have a user email
    email_sent = False
    if user_email:
        email_sent = await send_receipt_email(
            to_email=user_email,
            session_id=session_id,
            report_text=report_text,
            cart=cart,
            order_id=order_id,
            payment_id=payment_id,
        )

    # Step 3: Final audit entry
    async with AsyncSessionLocal() as db:
        report_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="report",
            decision="receipt_generated",
            reason=f"Receipt generated and {'emailed to ' + user_email if email_sent else 'available in session'}",
            amount=None,
            metadata={
                "order_id": order_id,
                "payment_id": payment_id,
                "email_sent": email_sent,
                "report_preview": report_text[:200],
            },
        )

    async with AsyncSessionLocal() as db:
        final_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="final_status",
            decision="completed",
            reason="Transaction completed successfully. Receipt generated.",
            amount=sum(item.get("price", 0) * item.get("quantity", 1) for item in cart),
        )

    trail = list(audit_trail)
    trail.extend([report_entry, final_entry])

    logger.info(
        "report_node_complete",
        session_id=session_id,
        email_sent=email_sent,
    )

    return {
        "report_text": report_text,
        "email_sent": email_sent,
        "current_gate": "end",
        "terminal_status": "completed",
        "pending_gate": None,
        "audit_trail": trail,
    }
