"""
Email service for sending payment receipts via SMTP.
Uses Gmail SMTP with app password (no SendGrid SDK needed).
"""
import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
import aiosmtplib
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()


def _build_receipt_html(
    session_id: str,
    report_text: str,
    cart: list[dict],
    order_id: Optional[str],
    payment_id: Optional[str],
) -> str:
    """Build a styled HTML email receipt."""
    total = sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)

    cart_rows = ""
    for item in cart:
        qty = item.get("quantity", 1)
        price = item.get("price", 0)
        cart_rows += f"""
        <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">{item.get("name", item.get("id"))}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">{qty}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹{price:.0f}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹{price * qty:.0f}</td>
        </tr>
        """

    report_paragraphs = report_text.replace("\n", "<br>")

    return f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CommerceOps Payment Receipt</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Arial, sans-serif;">
    <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 40px 32px; text-align: center;">
            <div style="font-size: 32px; margin-bottom: 8px;">✅</div>
            <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Payment Successful</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0 0; font-size: 14px;">CommerceOps AI Agent Receipt</p>
        </div>

        <!-- Order Summary -->
        <div style="padding: 32px;">
            <div style="background: #f1f5f9; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748b; font-size: 13px;">Session ID</span>
                    <span style="color: #1e293b; font-size: 13px; font-family: monospace;">{session_id[:16]}...</span>
                </div>
                {"<div style='display: flex; justify-content: space-between; margin-bottom: 8px;'><span style='color: #64748b; font-size: 13px;'>Order ID</span><span style='color: #1e293b; font-size: 13px; font-family: monospace;'>" + (order_id or "N/A") + "</span></div>" if order_id else ""}
                {"<div style='display: flex; justify-content: space-between;'><span style='color: #64748b; font-size: 13px;'>Payment ID</span><span style='color: #1e293b; font-size: 13px; font-family: monospace;'>" + (payment_id or "N/A") + "</span></div>" if payment_id else ""}
            </div>

            <!-- Cart Table -->
            <h2 style="color: #1e293b; font-size: 16px; font-weight: 600; margin: 0 0 16px 0;">Order Details</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <thead>
                    <tr style="background: #f8fafc;">
                        <th style="padding: 10px 12px; text-align: left; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">Item</th>
                        <th style="padding: 10px 12px; text-align: center; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">Qty</th>
                        <th style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">Price</th>
                        <th style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">Total</th>
                    </tr>
                </thead>
                <tbody>{cart_rows}</tbody>
                <tfoot>
                    <tr style="background: #f1f5f9;">
                        <td colspan="3" style="padding: 12px; text-align: right; font-weight: 700; color: #1e293b;">Total Paid</td>
                        <td style="padding: 12px; text-align: right; font-weight: 700; color: #6366f1; font-size: 18px;">₹{total:.0f}</td>
                    </tr>
                </tfoot>
            </table>

            <!-- AI Summary -->
            <div style="background: linear-gradient(135deg, #f0f0ff 0%, #faf5ff 100%); border: 1px solid #e0e7ff; border-radius: 8px; padding: 20px;">
                <h3 style="color: #4338ca; font-size: 14px; font-weight: 600; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    🤖 AI Agent Summary
                </h3>
                <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0;">{report_paragraphs}</p>
            </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                This receipt was generated by CommerceOps AI Agent.<br>
                Powered by Razorpay test-mode · LangGraph · Groq
            </p>
        </div>
    </div>
</body>
</html>
"""


async def send_receipt_email(
    to_email: str,
    session_id: str,
    report_text: str,
    cart: list[dict],
    order_id: Optional[str] = None,
    payment_id: Optional[str] = None,
) -> bool:
    """
    Send HTML payment receipt email via SMTP.

    Returns True on success, False on failure (non-fatal — logged but doesn't crash the flow).
    """
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.warning("smtp_not_configured_skipping_email", session_id=session_id)
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"✅ Payment Receipt — CommerceOps (Session {session_id[:8]}...)"
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to_email

        total = sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)
        plain_text = (
            f"Payment Successful — CommerceOps\n\n"
            f"Session: {session_id}\n"
            f"Total Paid: ₹{total:.0f}\n\n"
            f"AI Agent Summary:\n{report_text}\n\n"
            f"Thank you for your order!"
        )

        html_content = _build_receipt_html(session_id, report_text, cart, order_id, payment_id)

        msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        async with aiosmtplib.SMTP(
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            use_tls=False,
            start_tls=True,
        ) as smtp:
            await smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            await smtp.send_message(msg)

        logger.info("receipt_email_sent", to=to_email, session_id=session_id)
        return True

    except Exception as e:
        logger.error("receipt_email_failed", error=str(e), session_id=session_id)
        return False
