"""
User router — persistent cart and order history for authenticated users.
All routes require a valid Bearer JWT from /api/auth/login.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy import text
import uuid

from app.db.database import AsyncSessionLocal
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/user", tags=["user"])


# ── Pydantic schemas ──────────────────────────────────────────────────────

class AddCartItemRequest(BaseModel):
    product_id: str
    product_name: str
    product_price: float
    product_category: Optional[str] = None
    quantity: Optional[int] = 1


class CartItemOut(BaseModel):
    id: str
    product_id: str
    product_name: str
    product_price: float
    product_category: Optional[str]
    quantity: int
    added_at: str


class CreateOrderRequest(BaseModel):
    session_id: Optional[str] = None
    items: List[dict]
    total: float
    status: Optional[str] = "completed"


class OrderOut(BaseModel):
    id: str
    session_id: Optional[str]
    items: list
    total: float
    status: str
    created_at: str


# ── Cart endpoints ─────────────────────────────────────────────────────────

@router.get("/cart", response_model=List[CartItemOut])
async def get_cart(current_user: dict = Depends(get_current_user)):
    """Return all items in the user's persistent cart."""
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            text("""
                SELECT id, product_id, product_name, product_price,
                       product_category, quantity, added_at
                FROM cart_items
                WHERE user_id = :user_id
                ORDER BY added_at DESC
            """),
            {"user_id": str(current_user["id"])},
        )
        items = rows.mappings().all()

    return [
        CartItemOut(
            id=str(r["id"]),
            product_id=r["product_id"],
            product_name=r["product_name"],
            product_price=float(r["product_price"]),
            product_category=r["product_category"],
            quantity=int(r["quantity"]),
            added_at=str(r["added_at"]),
        )
        for r in items
    ]


@router.post("/cart", response_model=CartItemOut)
async def add_to_cart(
    body: AddCartItemRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a product to the user's cart. If already present, increments quantity."""
    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            text("""
                SELECT id, quantity FROM cart_items
                WHERE user_id = :user_id AND product_id = :product_id
            """),
            {"user_id": str(current_user["id"]), "product_id": body.product_id},
        )
        row = existing.mappings().first()

        if row:
            # Increment quantity
            new_qty = int(row["quantity"]) + (body.quantity or 1)
            await db.execute(
                text("UPDATE cart_items SET quantity = :qty WHERE id = :id"),
                {"qty": new_qty, "id": str(row["id"])},
            )
            await db.commit()
            item_id = str(row["id"])
        else:
            item_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO cart_items
                        (id, user_id, product_id, product_name, product_price, product_category, quantity, added_at)
                    VALUES
                        (:id, :user_id, :product_id, :product_name, :product_price, :product_category, :quantity, NOW())
                """),
                {
                    "id": item_id,
                    "user_id": str(current_user["id"]),
                    "product_id": body.product_id,
                    "product_name": body.product_name,
                    "product_price": body.product_price,
                    "product_category": body.product_category,
                    "quantity": body.quantity or 1,
                },
            )
            await db.commit()

        row2 = await db.execute(
            text("""
                SELECT id, product_id, product_name, product_price,
                       product_category, quantity, added_at
                FROM cart_items WHERE id = :id
            """),
            {"id": item_id},
        )
        item = dict(row2.mappings().first())

    return CartItemOut(
        id=str(item["id"]),
        product_id=item["product_id"],
        product_name=item["product_name"],
        product_price=float(item["product_price"]),
        product_category=item["product_category"],
        quantity=int(item["quantity"]),
        added_at=str(item["added_at"]),
    )


@router.delete("/cart/{product_id}", status_code=204)
async def remove_from_cart(
    product_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a product from the user's cart."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("DELETE FROM cart_items WHERE user_id = :user_id AND product_id = :product_id"),
            {"user_id": str(current_user["id"]), "product_id": product_id},
        )
        await db.commit()


@router.delete("/cart", status_code=204)
async def clear_cart(current_user: dict = Depends(get_current_user)):
    """Clear all items from the user's cart."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("DELETE FROM cart_items WHERE user_id = :user_id"),
            {"user_id": str(current_user["id"])},
        )
        await db.commit()


# ── Orders endpoints ───────────────────────────────────────────────────────

import json as _json

def _parse_items(raw) -> list:
    """Safely decode the 'items' jsonb column.
    asyncpg may return it already parsed (list/dict) or still as a raw JSON string.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            result = _json.loads(raw)
            return result if isinstance(result, list) else []
        except Exception:
            return []
    return []

@router.get("/orders", response_model=List[OrderOut])
async def get_orders(current_user: dict = Depends(get_current_user)):
    """Return the user's full order history, newest first."""
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            text("""
                SELECT id, session_id, items, total, status, created_at
                FROM orders
                WHERE user_id = :user_id
                ORDER BY created_at DESC
            """),
            {"user_id": str(current_user["id"])},
        )
        orders = rows.mappings().all()

    return [
        OrderOut(
            id=str(r["id"]),
            session_id=r["session_id"],
            items=_parse_items(r["items"]),
            total=float(r["total"]),
            status=r["status"],
            created_at=str(r["created_at"]),
        )
        for r in orders
    ]


@router.post("/orders", response_model=OrderOut)
async def create_order(
    body: CreateOrderRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Record a completed order. Called by the frontend after the agent
    reports a successful payment (terminal_status == 'completed').
    """
    import json
    order_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO orders (id, user_id, session_id, items, total, status, created_at)
                VALUES (:id, :user_id, :session_id, CAST(:items AS jsonb), :total, :status, NOW())
            """),
            {
                "id": order_id,
                "user_id": str(current_user["id"]),
                "session_id": body.session_id,
                "items": json.dumps(body.items),
                "total": body.total,
                "status": body.status or "completed",
            },
        )
        await db.commit()

        row = await db.execute(
            text("SELECT id, session_id, items, total, status, created_at FROM orders WHERE id = :id"),
            {"id": order_id},
        )
        order = dict(row.mappings().first())

    return OrderOut(
        id=str(order["id"]),
        session_id=order["session_id"],
        items=_parse_items(order["items"]),
        total=float(order["total"]),
        status=order["status"],
        created_at=str(order["created_at"]),
    )
