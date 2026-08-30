"""
Audit trail and catalog routers.
"""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from app.db.database import AsyncSessionLocal

audit_router = APIRouter(prefix="/api", tags=["audit"])
catalog_router = APIRouter(tags=["catalog"])

PRODUCTS_PATH = Path(__file__).parent.parent / "data" / "products.json"


@audit_router.get("/session/{session_id}/audit")
async def get_audit_trail(session_id: str):
    """
    Return the full audit trail for a session from PostgreSQL.
    Every gate, payment attempt, and retry is recorded here.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, session_id, step, decision, reason, amount, consent_token, metadata, created_at
                FROM audit_log
                WHERE session_id = :session_id
                ORDER BY created_at ASC
            """),
            {"session_id": session_id},
        )
        rows = result.fetchall()

    if not rows:
        # Session may be new — return empty trail, not 404
        return {"session_id": session_id, "trail": [], "total": 0}

    trail = []
    for row in rows:
        trail.append({
            "id": str(row.id),
            "session_id": row.session_id,
            "step": row.step,
            "decision": row.decision,
            "reason": row.reason,
            "amount": float(row.amount) if row.amount else None,
            "consent_token": row.consent_token,
            "metadata": row.metadata,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        })

    return {
        "session_id": session_id,
        "trail": trail,
        "total": len(trail),
    }


@catalog_router.get("/.well-known/catalog.json")
async def get_catalog():
    """
    Agent-readable product catalog — static JSON dump of all products.
    No LLM involved. This is what lets external AI buyers discover the merchant's inventory.

    Specification: flat JSON array with fields: id, name, price, stock, description, category
    """
    try:
        # Try to serve from Postgres first (authoritative after seeding)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                text("SELECT id, name, price, stock, description, category FROM products ORDER BY category, name")
            )
            rows = result.fetchall()

        if rows:
            return [
                {
                    "id": row.id,
                    "name": row.name,
                    "price": float(row.price),
                    "stock": int(row.stock),
                    "description": row.description,
                    "category": row.category,
                }
                for row in rows
            ]
    except Exception:
        pass

    # Fallback: serve from products.json (always available)
    with open(PRODUCTS_PATH, "r") as f:
        products = json.load(f)

    return [
        {
            "id": p["id"],
            "name": p["name"],
            "price": p["price"],
            "stock": p["stock"],
            "description": p["description"],
            "category": p["category"],
        }
        for p in products
    ]
