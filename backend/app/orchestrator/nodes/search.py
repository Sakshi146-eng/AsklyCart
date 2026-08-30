"""
Search node — parses query with Model A, searches Qdrant, returns shortlisted products.
"""
from datetime import datetime
from app.services.groq_client import parse_query, generate_reason
from app.services.qdrant_service import search_products
from app.orchestrator.audit_writer import write_audit_log
from app.db.database import AsyncSessionLocal
import structlog

logger = structlog.get_logger()


async def search_node(state: dict) -> dict:
    """
    Node: search
    1. Use Model A to parse the free-text query into structured parameters
    2. Run Qdrant vector search filtered to ≥2 matching parameters
    3. Write audit log entry
    4. Return search_results + parsed_query
    """
    session_id = state["session_id"]
    query = state["query"]

    # Step 1: Model A — parse query
    logger.info("search_node_parsing", session_id=session_id, query=query)
    parsed = await parse_query(query)

    # Step 2: Qdrant search
    results = await search_products(query_text=query, parsed_query=parsed, top_k=5)

    # Step 3: Audit log
    reason = await generate_reason({
        "gate": "search",
        "decision": f"found {len(results)} matching products",
        "query": query,
        "parsed": parsed,
        "top_result": results[0]["name"] if results else "none",
    })

    async with AsyncSessionLocal() as db:
        audit_entry = await write_audit_log(
            db=db,
            session_id=session_id,
            step="search",
            decision=f"found_{len(results)}_products",
            reason=reason,
            amount=None,
        )

    trail = list(state.get("audit_trail", []))
    trail.append(audit_entry)

    logger.info(
        "search_node_complete",
        session_id=session_id,
        results_count=len(results),
    )

    return {
        "parsed_query": parsed,
        "search_results": results,
        "audit_trail": trail,
        "current_gate": "cart",
    }
