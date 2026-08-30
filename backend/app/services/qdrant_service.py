"""
Qdrant vector search service using Google text-embedding-004 for embeddings.
"""
import asyncio
from typing import Optional
import google.generativeai as genai
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    Range,
    SearchRequest,
)
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

_qdrant_client: Optional[AsyncQdrantClient] = None

# Embedding dimension per model — must match what Qdrant collection was created with.
# If you change the embedding model, delete the Qdrant volume and re-run seed.py.
_EMBEDDING_DIMS = {
    "models/text-embedding-004": 768,
    "models/gemini-embedding-2": 3072,
    "models/text-embedding-005": 768,  # same as 004
}

def _get_embedding_dim() -> int:
    return _EMBEDDING_DIMS.get(settings.GEMINI_EMBEDDING_MODEL, 3072)

EMBEDDING_DIM = _get_embedding_dim()


def get_qdrant_client() -> AsyncQdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = AsyncQdrantClient(
            host=settings.QDRANT_HOST,
            port=settings.QDRANT_PORT,
        )
    return _qdrant_client


async def embed_text(text: str) -> list[float]:
    """Generate embedding using Google text-embedding-004."""
    genai.configure(api_key=settings.GOOGLE_API_KEY)
    result = genai.embed_content(
        model=settings.GEMINI_EMBEDDING_MODEL,
        content=text,
        task_type="retrieval_document",
    )
    return result["embedding"]


async def embed_query(text: str) -> list[float]:
    """Generate query embedding using Google text-embedding-004."""
    genai.configure(api_key=settings.GOOGLE_API_KEY)
    result = genai.embed_content(
        model=settings.GEMINI_EMBEDDING_MODEL,
        content=text,
        task_type="retrieval_query",
    )
    return result["embedding"]


async def ensure_collection_exists():
    """Create Qdrant collection if it doesn't exist, or recreate if dimension changed."""
    client = get_qdrant_client()
    collections = await client.get_collections()
    existing = [c.name for c in collections.collections]

    if settings.QDRANT_COLLECTION in existing:
        # Check if the existing collection has the right vector size
        info = await client.get_collection(settings.QDRANT_COLLECTION)
        current_dim = info.config.params.vectors.size
        if current_dim != EMBEDDING_DIM:
            logger.warning(
                "qdrant_dimension_mismatch",
                current=current_dim,
                expected=EMBEDDING_DIM,
                action="recreating_collection",
            )
            await client.delete_collection(settings.QDRANT_COLLECTION)
            existing = []  # Fall through to creation below

    if settings.QDRANT_COLLECTION not in existing:
        await client.create_collection(
            collection_name=settings.QDRANT_COLLECTION,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        logger.info(
            "qdrant_collection_created",
            collection=settings.QDRANT_COLLECTION,
            dim=EMBEDDING_DIM,
        )


async def upsert_product(product: dict, embedding: list[float]):
    """Upsert a single product into Qdrant."""
    client = get_qdrant_client()
    point = PointStruct(
        id=abs(hash(product["id"])) % (2**63),  # Convert string ID to int
        vector=embedding,
        payload={
            "product_id": product["id"],
            "name": product["name"],
            "price": float(product["price"]),
            "category": product["category"],
            "stock": int(product["stock"]),
            "description": product["description"],
        },
    )
    await client.upsert(collection_name=settings.QDRANT_COLLECTION, points=[point])


async def search_products(
    query_text: str,
    parsed_query: dict,
    top_k: int = 5,
) -> list[dict]:
    """
    Search Qdrant for products matching the query.
    Applies pre-filtering for price if a target_price is provided.
    Returns products that match at least 2 query parameters.
    """
    client = get_qdrant_client()

    # Build query vector
    query_vector = await embed_query(query_text)

    # Build optional price filter
    query_filter = None
    target_price = parsed_query.get("target_price")
    if target_price:
        query_filter = Filter(
            must=[
                FieldCondition(
                    key="price",
                    range=Range(lte=float(target_price)),
                )
            ]
        )

    # Search Qdrant
    results = await client.search(
        collection_name=settings.QDRANT_COLLECTION,
        query_vector=query_vector,
        query_filter=query_filter,
        limit=top_k * 2,  # Get more than needed so we can filter
        with_payload=True,
    )

    # Score results by how many query parameters they match
    matched_products = []
    for hit in results:
        payload = hit.payload
        match_count = 0

        # Check price match
        if target_price and payload.get("price", 0) <= float(target_price):
            match_count += 1

        # Check category match
        category = parsed_query.get("category")
        if category and payload.get("category", "").lower() == category.lower():
            match_count += 1

        # Check attribute matches in description + name
        attributes = parsed_query.get("attributes", [])
        product_text = (
            f"{payload.get('name', '')} {payload.get('description', '')}".lower()
        )
        for attr in attributes:
            if attr.lower() in product_text:
                match_count += 1

        # Check brand hint
        brand_hint = parsed_query.get("brand_hint")
        if brand_hint and brand_hint.lower() in product_text:
            match_count += 1

        # Vector similarity itself counts as 1 match
        if hit.score > 0.5:
            match_count += 1

        # Require at least 2 matching parameters
        if match_count >= 2:
            matched_products.append({
                "id": payload.get("product_id"),
                "name": payload.get("name"),
                "price": payload.get("price"),
                "category": payload.get("category"),
                "stock": payload.get("stock"),
                "description": payload.get("description"),
                "similarity_score": hit.score,
                "match_count": match_count,
            })

    # Sort by match count descending, then similarity
    matched_products.sort(key=lambda x: (-x["match_count"], -x["similarity_score"]))
    return matched_products[:top_k]
