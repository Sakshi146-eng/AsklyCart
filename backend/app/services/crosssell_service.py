"""
Cross-sell / upsell service.

Public interface: get_related_products(product_id) -> list[dict]

This function reads from a mock JSON relationship table and returns:
1. A combo-discount pairing (if one exists) — returned FIRST
2. Complementary or better-alternative products from the table
3. Empty list if no relationships defined

IMPORTANT: This function's signature is intentionally stable.
It is the seam where a Neo4j-backed implementation would be swapped in (Phase 2).
Do not inline the lookup logic elsewhere — always call through this function.
"""
import json
from pathlib import Path
from typing import Optional
import structlog

logger = structlog.get_logger()

# Path to the mock relationship table
RELATIONSHIPS_PATH = Path(__file__).parent.parent / "data" / "relationships.json"
PRODUCTS_PATH = Path(__file__).parent.parent / "data" / "products.json"

# Cache loaded data in memory
_relationships: Optional[dict] = None
_products_by_id: Optional[dict] = None


def _load_relationships() -> dict:
    global _relationships
    if _relationships is None:
        with open(RELATIONSHIPS_PATH, "r") as f:
            _relationships = json.load(f)
    return _relationships


def _load_products_by_id() -> dict:
    global _products_by_id
    if _products_by_id is None:
        with open(PRODUCTS_PATH, "r") as f:
            products = json.load(f)
        _products_by_id = {p["id"]: p for p in products}
    return _products_by_id


def get_related_products(product_id: str) -> list[dict]:
    """
    Returns related products for a given product_id.

    Return format (each item):
    {
        "type": "combo_discount" | "complementary" | "better_alternative" | "cheaper_alternative",
        "product": { ...full product dict... },
        "combo_price": float | None,   # only for combo_discount type
        "combo_label": str | None,     # only for combo_discount type
        "with_product_id": str | None, # only for combo_discount type
    }

    Phase 2 contract: Replace the body of this function with a Neo4j query.
    The return shape must remain identical.
    """
    relationships = _load_relationships()
    products = _load_products_by_id()

    rel = relationships.get(product_id)
    if not rel:
        logger.debug("no_relationships_found", product_id=product_id)
        return []

    results = []

    # 1. Combo discount — always returned first if it exists
    combo = rel.get("combo_discount")
    if combo:
        partner_id = combo.get("with")
        partner_product = products.get(partner_id)
        if partner_product:
            results.append({
                "type": "combo_discount",
                "product": partner_product,
                "combo_price": combo.get("combined_price"),
                "combo_label": combo.get("label"),
                "with_product_id": partner_id,
            })

    # 2. Better alternative
    better_id = rel.get("better_alternative")
    if better_id and better_id not in [r["product"]["id"] for r in results]:
        better_product = products.get(better_id)
        if better_product:
            results.append({
                "type": "better_alternative",
                "product": better_product,
                "combo_price": None,
                "combo_label": None,
                "with_product_id": None,
            })

    # 3. Cheaper alternative
    cheaper_id = rel.get("cheaper_alternative")
    if cheaper_id and cheaper_id not in [r["product"]["id"] for r in results]:
        cheaper_product = products.get(cheaper_id)
        if cheaper_product:
            results.append({
                "type": "cheaper_alternative",
                "product": cheaper_product,
                "combo_price": None,
                "combo_label": None,
                "with_product_id": None,
            })

    # 4. General related products (up to 2 additional)
    related_ids = rel.get("related", [])
    seen_ids = {r["product"]["id"] for r in results}
    for rel_id in related_ids:
        if rel_id not in seen_ids:
            rel_product = products.get(rel_id)
            if rel_product:
                results.append({
                    "type": "complementary",
                    "product": rel_product,
                    "combo_price": None,
                    "combo_label": None,
                    "with_product_id": None,
                })
            seen_ids.add(rel_id)
            if len(results) >= 4:
                break

    logger.info(
        "cross_sell_lookup",
        product_id=product_id,
        results_count=len(results),
        has_combo=bool(combo),
    )
    return results
