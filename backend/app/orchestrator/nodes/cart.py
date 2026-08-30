"""
Cart node — takes the top search result and adds it to the cart.
"""
from app.services.groq_client import generate_reason
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


async def cart_node(state: dict) -> dict:
    """
    Node: cart
    Takes the best matching product from search results, adds it to the cart.
    Also seeds the cart from Redis if items already exist from prior interaction.
    """
    session_id = state["session_id"]
    search_results = state.get("search_results", [])
    existing_cart = list(state.get("cart", []))

    if not search_results:
        # No results — nothing to add
        return {
            "cart": existing_cart,
            "current_gate": "gate1",
            "audit_trail": state.get("audit_trail", []),
        }

    # Take the top result (highest match_count + similarity)
    top_product = search_results[0]
    cart_item = {
        "id": top_product["id"],
        "name": top_product["name"],
        "price": float(top_product["price"]),
        "category": top_product.get("category", ""),
        "stock": top_product.get("stock", 0),
        "description": top_product.get("description", ""),
        "quantity": 1,
    }

    # Add to cart (avoid duplicates)
    existing_ids = {item["id"] for item in existing_cart}
    if cart_item["id"] not in existing_ids:
        existing_cart.append(cart_item)

    reason = await generate_reason({
        "gate": "cart",
        "decision": "added_to_cart",
        "product_name": cart_item["name"],
        "price": cart_item["price"],
        "extra": f"Best match from {len(search_results)} search results",
    })

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="cart",
            decision="added_to_cart",
            reason=reason,
            amount=cart_item["price"],
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    logger.info(
        "cart_node_complete",
        session_id=session_id,
        product_id=cart_item["id"],
        cart_size=len(existing_cart),
    )

    return {
        "cart": existing_cart,
        "audit_trail": trail,
        "current_gate": "crosssell",
    }
