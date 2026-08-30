"""
Seed script — populates Qdrant and PostgreSQL with mock product catalog.
Run on first startup (or via docker-compose init container).

Usage:
    python seed.py

Environment: requires .env file in project root.
"""
import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from app.config import get_settings
from app.services.qdrant_service import ensure_collection_exists, upsert_product, embed_text
from app.db.database import AsyncSessionLocal
from sqlalchemy import text
import structlog

logger = structlog.get_logger()
settings = get_settings()

PRODUCTS_PATH = Path(__file__).parent / "app" / "data" / "products.json"


async def seed_postgres(products: list[dict]):
    """Insert all products into PostgreSQL."""
    logger.info("seeding_postgres", count=len(products))
    async with AsyncSessionLocal() as db:
        for p in products:
            await db.execute(
                text("""
                    INSERT INTO products (id, name, price, category, stock, description, embedding_text, created_at)
                    VALUES (:id, :name, :price, :category, :stock, :description, :embedding_text, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        price = EXCLUDED.price,
                        stock = EXCLUDED.stock,
                        description = EXCLUDED.description
                """),
                {
                    "id": p["id"],
                    "name": p["name"],
                    "price": p["price"],
                    "category": p["category"],
                    "stock": p["stock"],
                    "description": p.get("description", ""),
                    "embedding_text": p.get("embedding_text", ""),
                }
            )
        await db.commit()
    logger.info("postgres_seeded", count=len(products))


async def seed_qdrant(products: list[dict]):
    """Embed and upsert all products into Qdrant."""
    logger.info("seeding_qdrant", count=len(products))
    await ensure_collection_exists()

    for i, product in enumerate(products):
        embed_input = product.get("embedding_text", product.get("description", product["name"]))
        logger.info(f"embedding_product_{i+1}/{len(products)}", product_id=product["id"])

        embedding = await embed_text(embed_input)
        await upsert_product(product, embedding)

        # Small delay to avoid rate limiting
        await asyncio.sleep(0.1)

    logger.info("qdrant_seeded", count=len(products))


async def main():
    logger.info("seed_starting")

    # Load products
    with open(PRODUCTS_PATH, "r") as f:
        products = json.load(f)

    logger.info("products_loaded", count=len(products))

    # Seed PostgreSQL
    try:
        await seed_postgres(products)
    except Exception as e:
        logger.error("postgres_seed_failed", error=str(e))
        logger.warning("continuing_without_postgres")

    # Seed Qdrant
    try:
        await seed_qdrant(products)
    except Exception as e:
        logger.error("qdrant_seed_failed", error=str(e))

    logger.info("seed_complete", products=len(products))


if __name__ == "__main__":
    asyncio.run(main())
