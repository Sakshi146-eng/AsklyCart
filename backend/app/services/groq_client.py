"""
Groq LLM client — two distinct models for two distinct jobs.

Model A (fast/cheap): Parses free-text user queries into structured filter params.
Model B (reasoning): Generates human-readable explanations for every audit log entry.

Keeping these as two separate functions with distinct prompts is intentional — it's
what makes the audit trail explainable rather than a single opaque black-box call.
"""
import json
from typing import Optional
from groq import AsyncGroq
from app.config import get_settings

settings = get_settings()
_client: Optional[AsyncGroq] = None


def get_groq_client() -> AsyncGroq:
    global _client
    if _client is None:
        _client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    return _client


# ─────────────────────────────────────────────────────────────
# Model A — Query Parser (fast, cheap, structured output)
# ─────────────────────────────────────────────────────────────

PARSE_QUERY_SYSTEM = """You are a product search query parser for an e-commerce platform.
Extract structured search parameters from the user's free-text query.
Return ONLY valid JSON with the following fields:
- product_type: string (e.g. "water bottle", "thermos", "lunch box", "mug", "cleaner", "filter")
- target_price: number or null (maximum price the user wants to pay, in INR)
- attributes: array of strings (e.g. ["insulated", "stainless steel", "750ml", "BPA-free"])
- category: string or null (e.g. "water_bottles", "thermos", "lunch_boxes", "mugs", "cleaning", "filters", "accessories", "bundles")
- brand_hint: string or null (any brand name mentioned)

Rules:
- If the user says "under ₹X" or "at ₹X" or "below ₹X", set target_price to that number
- Extract physical attributes (size, material, color, capacity) as attributes
- Return ONLY the JSON object, no markdown, no explanation
"""


async def parse_query(text: str) -> dict:
    """
    Model A: Parse free-text search query into structured filter parameters.
    Uses llama-3.1-8b-instant for fast, cheap structured extraction.
    """
    client = get_groq_client()
    response = await client.chat.completions.create(
        model=settings.GROQ_MODEL_A,
        messages=[
            {"role": "system", "content": PARSE_QUERY_SYSTEM},
            {"role": "user", "content": f"Parse this search query: {text}"}
        ],
        temperature=0.1,
        max_tokens=300,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {
            "product_type": text,
            "target_price": None,
            "attributes": [],
            "category": None,
            "brand_hint": None,
        }


# ─────────────────────────────────────────────────────────────
# Model B — Audit Reasoner (thoughtful, human-readable)
# ─────────────────────────────────────────────────────────────

REASON_SYSTEM = """You are the audit explanation engine for an AI shopping agent called AsklyCart.
Your job is to produce clear, concise, one-sentence explanations for every decision the agent makes.
These explanations are written to the immutable audit log and shown to users and compliance reviewers.

Rules:
- Be specific: include actual numbers (prices, caps, retry counts) in your explanation
- Be honest: if auto-approved, say so; if escalated, say so; if failed, say why
- Use plain English, no jargon, no markdown
- Maximum 2 sentences
- Do not make up information not provided in the context
"""


async def generate_reason(context: dict) -> str:
    """
    Model B: Generate a human-readable audit reason string for a given gate/step context.
    Uses llama-3.3-70b-versatile for thoughtful, reasoned explanations.

    context fields vary by step:
    - gate: which gate fired (gate1, gate2, gate4, gate3, crosssell, payment_attempt, etc.)
    - decision: what happened (approved, escalated, abandoned, success, failed, etc.)
    - amount: transaction amount if applicable
    - cap: spending cap if applicable
    - product_name: product name if applicable
    - retry_count: current retry count if applicable
    - extra: any additional context string
    """
    client = get_groq_client()
    context_str = json.dumps(context, ensure_ascii=False)
    response = await client.chat.completions.create(
        model=settings.GROQ_MODEL_B,
        messages=[
            {"role": "system", "content": REASON_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Generate a plain-English audit log explanation for this agent decision:\n"
                    f"{context_str}\n\n"
                    f"Write one concise sentence explaining what happened and why."
                )
            }
        ],
        temperature=0.3,
        max_tokens=150,
    )
    return response.choices[0].message.content.strip()


async def generate_report(session_id: str, audit_trail: list[dict], cart: list[dict]) -> str:
    """
    Model B: Reads the full audit trail and produces a human-readable receipt/report.
    Called once after a successful payment.
    """
    client = get_groq_client()

    trail_text = "\n".join([
        f"[{row.get('step', '').upper()}] {row.get('decision', '')} — {row.get('reason', '')} "
        f"(₹{row.get('amount', '')} at {row.get('created_at', '')})"
        for row in audit_trail
    ])

    cart_text = "\n".join([
        f"- {item.get('name', item.get('id', 'Unknown'))} × {item.get('quantity', 1)} @ ₹{item.get('price', 0)}"
        for item in cart
    ])

    total = sum(item.get("price", 0) * item.get("quantity", 1) for item in cart)

    response = await client.chat.completions.create(
        model=settings.GROQ_MODEL_B,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are AsklyCart, an AI shopping agent. Write a friendly, professional "
                    "payment receipt summary for the customer. Include what they bought, total paid, "
                    "and a brief readable narrative of how the AI agent handled the transaction "
                    "(gates checked, approvals given, any cross-sell accepted). "
                    "Keep it warm and concise. Use ₹ for currency. "
                    "Format using clean markdown: use **bold** for key terms and headings, "
                    "numbered lists (1. 2. 3.) for steps, bullet points (- ) for items, "
                    "and --- for section dividers. Do NOT use any HTML tags."
                )
            },
            {
                "role": "user",
                "content": (
                    f"Session ID: {session_id}\n\n"
                    f"Items purchased:\n{cart_text}\n\n"
                    f"Total: ₹{total}\n\n"
                    f"Full audit trail:\n{trail_text}\n\n"
                    "Write the receipt summary."
                )
            }
        ],
        temperature=0.4,
        max_tokens=500,
    )
    return response.choices[0].message.content.strip()
