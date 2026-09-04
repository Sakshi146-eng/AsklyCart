"""
Browse router — product discovery WITHOUT triggering the agent flow.

POST /api/browse          → 3-section search results (matched, combos, related)
GET  /api/browse/product/{id} → full product detail + related + combo
"""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.groq_client import parse_query
from app.services.qdrant_service import search_products
import structlog

router = APIRouter(prefix="/api/browse", tags=["browse"])
logger = structlog.get_logger()

_PRODUCTS_PATH = Path(__file__).parent.parent / "data" / "products.json"
_RELATIONSHIPS_PATH = Path(__file__).parent.parent / "data" / "relationships.json"


def _product_map() -> dict[str, dict]:
    with open(_PRODUCTS_PATH) as f:
        return {p["id"]: p for p in json.load(f)}


def _relationships() -> dict:
    with open(_RELATIONSHIPS_PATH) as f:
        return json.load(f)


# ── Request / Response models ─────────────────────────────────────────────

class BrowseRequest(BaseModel):
    query: str


class BrowseResponse(BaseModel):
    matched_products: list[dict]
    combo_products: list[dict]
    related_products: list[dict]
    parsed_query: dict


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("", response_model=BrowseResponse)
async def browse_products(body: BrowseRequest):
    """
    Browse search — runs Model A parse + Qdrant vector search, then enriches
    with relationship data to produce three UI sections.
    Does NOT create a session or start the agent.
    """
    logger.info("browse_request", query=body.query)

    # 1. Parse query with Model A
    parsed = await parse_query(body.query)

    # 2. Qdrant vector search (≥2 param matches already filtered)
    results = await search_products(query_text=body.query, parsed_query=parsed, top_k=6)

    # 3. Load static data
    product_map = _product_map()
    rels = _relationships()

    combo_seen: set[str] = set()
    related_seen: set[str] = set()
    matched_ids: set[str] = {r["id"] for r in results}

    combo_products: list[dict] = []
    related_products: list[dict] = []

    for product in results[:3]:
        pid = product.get("id", "")
        rel = rels.get(pid, {})

        # ── Combo deals ──────────────────────────────────────────────────
        combo = rel.get("combo_discount")
        if combo and combo.get("with"):
            cid = combo["with"]
            if cid not in combo_seen and cid in product_map:
                combo_seen.add(cid)
                entry = {
                    **product_map[cid],
                    "combo_with_id": pid,
                    "combo_with_name": product.get("name", ""),
                    "combo_price": combo.get("combined_price"),
                    "combo_label": combo.get("label"),
                    "original_total": product.get("price", 0) + product_map[cid].get("price", 0),
                }
                combo_products.append(entry)

        # ── Related products ──────────────────────────────────────────────
        for rid in (rel.get("related") or []):
            if rid not in related_seen and rid not in matched_ids and rid in product_map:
                related_seen.add(rid)
                related_products.append(product_map[rid])

        # ── Alternatives ──────────────────────────────────────────────────
        for alt_key in ("better_alternative", "cheaper_alternative"):
            alt_id = rel.get(alt_key)
            if alt_id and alt_id not in related_seen and alt_id not in matched_ids and alt_id in product_map:
                related_seen.add(alt_id)
                rp = {**product_map[alt_id], "alternative_type": alt_key}
                related_products.append(rp)

    return BrowseResponse(
        matched_products=results,
        combo_products=combo_products[:4],
        related_products=related_products[:6],
        parsed_query=parsed,
    )


@router.get("/product/{product_id}")
async def get_product_detail(product_id: str):
    """
    Full product detail by ID + related products + combo deal.
    Used by the product detail page.
    """
    product_map = _product_map()
    rels = _relationships()

    if product_id not in product_map:
        raise HTTPException(status_code=404, detail=f"Product '{product_id}' not found")

    product = product_map[product_id]
    rel = rels.get(product_id, {})

    # Related products
    related = [product_map[rid] for rid in (rel.get("related") or []) if rid in product_map]

    # Combo deal
    combo = None
    cd = rel.get("combo_discount")
    if cd and cd.get("with") and cd["with"] in product_map:
        combo = {
            "product": product_map[cd["with"]],
            "combined_price": cd.get("combined_price"),
            "label": cd.get("label"),
            "savings": (product["price"] + product_map[cd["with"]]["price"]) - cd.get("combined_price", 0),
        }

    return {
        "product": product,
        "related_products": related[:4],
        "combo": combo,
        "better_alternative": product_map.get(rel.get("better_alternative")),
        "cheaper_alternative": product_map.get(rel.get("cheaper_alternative")),
    }
