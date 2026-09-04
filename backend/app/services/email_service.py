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
            <td style="padding: 12px 16px; border-bottom: 1px solid #222; color: #fff;">{item.get("name", item.get("id"))}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #222; text-align: center; color: #aaa;">{qty}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #222; text-align: right; color: #aaa;">₹{price:.0f}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #222; text-align: right; color: #C9A227; font-weight: 600;">₹{price * qty:.0f}</td>
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
<body style="margin: 0; padding: 0; background-color: #080808; font-family: 'Segoe UI', Arial, sans-serif;">
    <div style="max-width: 600px; margin: 40px auto; background-color: #111111; border-radius: 12px; overflow: hidden; border: 1px solid #222;">

        <!-- Header -->
        <div style="background: linear-gradient(135deg, #C9A227 0%, #8B6914 100%); padding: 40px 32px; text-align: center;">
            <div style="font-size: 40px; margin-bottom: 12px;">✅</div>
            <h1 style="color: #000; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Payment Successful</h1>
            <p style="color: rgba(0,0,0,0.7); margin: 10px 0 0 0; font-size: 14px; font-weight: 500;">CommerceOps AI Agent · Official Receipt</p>
        </div>

        <!-- Order Meta -->
        <div style="padding: 24px 32px; border-bottom: 1px solid #222;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #888; font-size: 13px;">Session ID</span>
                <span style="color: #C9A227; font-size: 13px; font-family: monospace;">{session_id[:16]}...</span>
            </div>
            {f"<div style='display:flex;justify-content:space-between;margin-bottom:8px;'><span style='color:#888;font-size:13px;'>Order ID</span><span style='color:#C9A227;font-size:13px;font-family:monospace;'>{order_id}</span></div>" if order_id else ""}
            {f"<div style='display:flex;justify-content:space-between;'><span style='color:#888;font-size:13px;'>Payment ID</span><span style='color:#C9A227;font-size:13px;font-family:monospace;'>{payment_id}</span></div>" if payment_id else ""}
        </div>

        <!-- Cart Table -->
        <div style="padding: 32px;">
            <h2 style="color: #fff; font-size: 16px; font-weight: 600; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 1px;">Order Details</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 0;">
                <thead>
                    <tr style="background: #1a1a1a;">
                        <th style="padding: 10px 16px; text-align: left; color: #888; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Item</th>
                        <th style="padding: 10px 16px; text-align: center; color: #888; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Qty</th>
                        <th style="padding: 10px 16px; text-align: right; color: #888; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Price</th>
                        <th style="padding: 10px 16px; text-align: right; color: #888; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Total</th>
                    </tr>
                </thead>
                <tbody>{cart_rows}</tbody>
                <tfoot>
                    <tr style="background: #1a1a1a;">
                        <td colspan="3" style="padding: 16px; text-align: right; font-weight: 700; color: #aaa; font-size: 14px;">Total Paid</td>
                        <td style="padding: 16px; text-align: right; font-weight: 800; color: #C9A227; font-size: 22px;">₹{total:.0f}</td>
                    </tr>
                </tfoot>
            </table>
        </div>

        <!-- AI Summary -->
        <div style="margin: 0 32px 32px; background: #1a1a1a; border: 1px solid #C9A22733; border-radius: 8px; padding: 20px;">
            <h3 style="color: #C9A227; font-size: 13px; font-weight: 700; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">🤖 AI Agent Summary</h3>
            <p style="color: #ccc; font-size: 14px; line-height: 1.7; margin: 0;">{report_paragraphs}</p>
        </div>

        <!-- Footer -->
        <div style="background: #0d0d0d; padding: 20px 32px; text-align: center; border-top: 1px solid #222;">
            <p style="color: #555; font-size: 12px; margin: 0;">
                Generated by <span style="color: #C9A227;">CommerceOps</span> AI Agent<br>
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

    Returns True on success, False on failure (non-fatal - logged but doesn't crash the flow).
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
