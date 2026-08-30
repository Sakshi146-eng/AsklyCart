"""
Cross-sell node — checks the top cart item for related products and surfaces suggestions.
"""
from app.services.crosssell_service import get_related_products
from app.services.groq_client import generate_reason
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


async def crosssell_node(state: dict) -> dict:
    """
    Node: crosssell

    Runs immediately after add-to-cart:
    1. Look up the primary cart item in the relationship table
    2. If there's a combo-discount → surface that first
    3. Otherwise → surface cheaper/complementary companion or better alternative
    4. Pause flow: set pending_gate = "crosssell" so the frontend can show the banner
    5. Log whether suggestion was shown (acceptance handled by consent API, not this node)
    """
    session_id = state["session_id"]
    cart = state.get("cart", [])

    if not cart:
        return {
            "cross_sell_suggestions": [],
            "cross_sell_shown": False,
            "current_gate": "gate1",
            "audit_trail": state.get("audit_trail", []),
        }

    # Look up the first cart item's related products
    primary_item = cart[0]
    suggestions = get_related_products(primary_item["id"])

    shown = len(suggestions) > 0

    # Build the prompt for the user
    gate_prompt = None
    if suggestions:
        top = suggestions[0]
        if top["type"] == "combo_discount":
            gate_prompt = (
                f"🎁 Combo Deal! Pair your {primary_item['name']} with "
                f"{top['product']['name']} for just ₹{top['combo_price']} "
                f"(save ₹{float(primary_item['price']) + float(top['product']['price']) - float(top['combo_price']):.0f}). "
                f"Would you like to add the combo to your cart?"
            )
        elif top["type"] == "better_alternative":
            gate_prompt = (
                f"⭐ Upgrade option: {top['product']['name']} at ₹{top['product']['price']} "
                f"is a premium alternative to {primary_item['name']}. Interested?"
            )
        elif top["type"] == "cheaper_alternative":
            gate_prompt = (
                f"💰 Budget option: {top['product']['name']} at ₹{top['product']['price']} "
                f"is a more affordable alternative. Want to switch?"
            )
        else:
            gate_prompt = (
                f"🛍️ Customers who bought {primary_item['name']} also loved "
                f"{top['product']['name']} (₹{top['product']['price']}). Add it?"
            )

    # Model B: generate audit reason
    reason = await generate_reason({
        "gate": "crosssell",
        "decision": "suggestions_shown" if shown else "no_suggestions",
        "product_name": primary_item["name"],
        "suggestions_count": len(suggestions),
        "top_type": suggestions[0]["type"] if suggestions else "none",
    })

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="crosssell",
            decision="shown" if shown else "no_suggestions",
            reason=reason,
            amount=suggestions[0].get("combo_price") if suggestions and suggestions[0].get("combo_price") else None,
            metadata={"suggestions_count": len(suggestions)},
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    logger.info(
        "crosssell_node_complete",
        session_id=session_id,
        suggestions_count=len(suggestions),
        shown=shown,
    )

    return {
        "cross_sell_suggestions": suggestions,
        "cross_sell_shown": shown,
        "cross_sell_accepted": False,
        "pending_gate": "crosssell" if shown else None,
        "gate_prompt": gate_prompt,
        "audit_trail": trail,
        "current_gate": "gate1",
    }
