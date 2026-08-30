"""
Razorpay test-mode payment service.

Implements Razorpay's Order + Payment creation flow in test mode.
Returns success/failure cleanly for the orchestrator to route.

FORCE_PAYMENT_FAIL env var: set to 1 to force failures for Gate 3 / retry demo.
"""
import razorpay
from typing import Optional
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

_razorpay_client: Optional[razorpay.Client] = None


def get_razorpay_client() -> razorpay.Client:
    global _razorpay_client
    if _razorpay_client is None:
        _razorpay_client = razorpay.Client(
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
        )
    return _razorpay_client


async def create_order(amount_inr: float, session_id: str) -> dict:
    """
    Create a Razorpay order in test mode.

    Args:
        amount_inr: Amount in INR (will be converted to paise)
        session_id: Session ID for receipt/notes

    Returns:
        {
            "success": bool,
            "order_id": str | None,
            "razorpay_order": dict | None,
            "error": str | None,
        }
    """
    # Debug override: force failure for demo purposes
    if settings.FORCE_PAYMENT_FAIL:
        logger.warning("force_payment_fail_enabled", session_id=session_id)
        return {
            "success": False,
            "order_id": None,
            "razorpay_order": None,
            "error": "Payment failed (FORCE_PAYMENT_FAIL=true — simulated failure for demo)",
        }

    try:
        client = get_razorpay_client()

        # Razorpay requires amount in paise (1 INR = 100 paise)
        amount_paise = int(amount_inr * 100)

        order_data = {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"commerceops_{session_id[:8]}",
            "notes": {
                "session_id": session_id,
                "source": "commerceops_ai_agent",
            },
        }

        order = client.order.create(order_data)

        logger.info(
            "razorpay_order_created",
            session_id=session_id,
            order_id=order.get("id"),
            amount=amount_inr,
        )

        return {
            "success": True,
            "order_id": order.get("id"),
            "razorpay_order": order,
            "error": None,
        }

    except razorpay.errors.BadRequestError as e:
        logger.error("razorpay_bad_request", error=str(e), session_id=session_id)
        return {
            "success": False,
            "order_id": None,
            "razorpay_order": None,
            "error": f"Razorpay bad request: {str(e)}",
        }
    except razorpay.errors.ServerError as e:
        logger.error("razorpay_server_error", error=str(e), session_id=session_id)
        return {
            "success": False,
            "order_id": None,
            "razorpay_order": None,
            "error": f"Razorpay server error: {str(e)}",
        }
    except Exception as e:
        logger.error("razorpay_unexpected_error", error=str(e), session_id=session_id)
        return {
            "success": False,
            "order_id": None,
            "razorpay_order": None,
            "error": f"Unexpected payment error: {str(e)}",
        }


async def simulate_payment_capture(order_id: str, amount_inr: float) -> dict:
    """
    In test mode, Razorpay orders are created but actual capture requires
    a checkout page. This simulates the capture response for the demo.

    In a real integration this would verify webhook signature from Razorpay.
    Returns a simulated payment success payload.
    """
    if settings.FORCE_PAYMENT_FAIL:
        return {
            "success": False,
            "payment_id": None,
            "error": "Payment capture failed (simulated)",
        }

    # In test mode with real Razorpay keys, we simulate a successful capture
    return {
        "success": True,
        "payment_id": f"pay_test_{order_id[-8:] if order_id else 'simulated'}",
        "amount": amount_inr,
        "error": None,
    }
