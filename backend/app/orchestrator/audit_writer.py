"""
Audit logging helper — writes one row to the audit_log table.
Called by every gate node and payment node.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import structlog
import json

logger = structlog.get_logger()


# async def write_audit_log(
#     db: AsyncSession,
#     session_id: str,
#     step: str,
#     decision: str,
#     reason: str,
#     amount: Optional[float] = None,
#     consent_token: Optional[str] = None,
#     metadata: Optional[dict] = None,
# ) -> dict:
#     """
#     Write one row to the audit_log table.

#     Every gate, every payment attempt, and every retry MUST call this.
#     This is the primary judged deliverable.

#     Returns the created audit entry as a dict for appending to state.audit_trail.
#     """
#     now = datetime.utcnow().isoformat()

#     try:
#         await db.execute(
#             text("""
#                 INSERT INTO audit_log (session_id, step, decision, reason, amount, consent_token, metadata, created_at)
#                 VALUES (:session_id, :step, :decision, :reason, :amount, :consent_token, :metadata::jsonb, NOW())
#             """),
#             {
#                 "session_id": session_id,
#                 "step": step,
#                 "decision": decision,
#                 "reason": reason,
#                 "amount": amount,
#                 "consent_token": consent_token,
#                 "metadata": str(metadata) if metadata else None,
#             },
#         )
#         await db.commit()

#         logger.info(
#             "audit_log_written",
#             session_id=session_id,
#             step=step,
#             decision=decision,
#         )

#     except Exception as e:
#         logger.error("audit_log_write_failed", error=str(e), session_id=session_id, step=step)
#         await db.rollback()

#     return {
#         "step": step,
#         "decision": decision,
#         "reason": reason,
#         "amount": amount,
#         "consent_token": consent_token,
#         "created_at": now,
#     }
async def write_audit_log(
    db: AsyncSession,
    session_id: str,
    step: str,
    decision: str,
    reason: str,
    amount: Optional[float] = None,
    consent_token: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> dict:

    now = datetime.utcnow().isoformat()

    try:
        await db.execute(
            text("""
                INSERT INTO audit_log (
                    session_id,
                    step,
                    decision,
                    reason,
                    amount,
                    consent_token,
                    metadata,
                    created_at
                )
                VALUES (
                    :session_id,
                    :step,
                    :decision,
                    :reason,
                    :amount,
                    :consent_token,
                    CAST(:metadata AS jsonb),
                    NOW()
                )
            """),
            {
                "session_id": session_id,
                "step": step,
                "decision": decision,
                "reason": reason,
                "amount": amount,
                "consent_token": consent_token,
                "metadata": json.dumps(metadata) if metadata else None,
            },
        )

        await db.commit()

        logger.info(
            "audit_log_written",
            session_id=session_id,
            step=step,
            decision=decision,
        )

    except Exception as e:
        logger.error(
            "audit_log_write_failed",
            error=str(e),
            session_id=session_id,
            step=step,
        )
        await db.rollback()

    return {
        "step": step,
        "decision": decision,
        "reason": reason,
        "amount": amount,
        "consent_token": consent_token,
        "created_at": now,
    }