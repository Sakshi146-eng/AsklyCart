"""
LangGraph state machine — the CommerceOps orchestrator.

Nodes:
  search → cart → crosssell → gate1 → gate2 → [gate4 | payment] → [gate3 → retry] → report

The graph is compiled once at module load. Sessions run as graph invocations with
interrupt_before on gate nodes, allowing the FastAPI consent API to inject user decisions.
"""
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from app.orchestrator.state import AgentState
from app.orchestrator.nodes.search import search_node
from app.orchestrator.nodes.cart import cart_node
from app.orchestrator.nodes.crosssell import crosssell_node
from app.orchestrator.nodes.gates import gate1_node, gate2_node, gate4_node, gate3_node
from app.orchestrator.nodes.payment import payment_node
from app.orchestrator.nodes.retry import retry_node
from app.orchestrator.nodes.report import report_node
from app.orchestrator.edges import (
    route_after_gate1,
    route_after_gate2,
    route_after_gate4,
    route_after_payment,
    route_after_gate3,
    route_after_crosssell,
)
import structlog

logger = structlog.get_logger()

# In-memory checkpointer for gate pause/resume (replace with Redis-backed for production)
memory_saver = MemorySaver()


def build_graph():
    """Build and compile the LangGraph state machine."""
    graph = StateGraph(AgentState)

    # ── Register all nodes ────────────────────────────────────
    graph.add_node("search", search_node)
    graph.add_node("add_to_cart", cart_node)  # Note: can't use 'cart' — it's a state key name
    graph.add_node("crosssell", crosssell_node)
    graph.add_node("gate1", gate1_node)
    graph.add_node("gate2", gate2_node)
    graph.add_node("gate4", gate4_node)
    graph.add_node("payment", payment_node)
    graph.add_node("gate3", gate3_node)
    graph.add_node("retry", retry_node)
    graph.add_node("report", report_node)

    # ── Entry point ───────────────────────────────────────────
    graph.set_entry_point("search")

    # ── Linear edges ──────────────────────────────────────────
    graph.add_edge("search", "add_to_cart")
    graph.add_edge("add_to_cart", "crosssell")
    graph.add_edge("retry", "payment")

    # ── Conditional edges ─────────────────────────────────────
    graph.add_conditional_edges(
        "crosssell",
        route_after_crosssell,
        {"gate1": "gate1"},
    )

    graph.add_conditional_edges(
        "gate1",
        route_after_gate1,
        {
            "gate2": "gate2",
            "end": END,
        },
    )

    graph.add_conditional_edges(
        "gate2",
        route_after_gate2,
        {
            "payment": "payment",
            "gate4": "gate4",
        },
    )

    graph.add_conditional_edges(
        "gate4",
        route_after_gate4,
        {
            "payment": "payment",
            "end": END,
        },
    )

    graph.add_conditional_edges(
        "payment",
        route_after_payment,
        {
            "report": "report",
            "gate3": "gate3",
        },
    )

    graph.add_conditional_edges(
        "gate3",
        route_after_gate3,
        {
            "retry": "retry",
            "end": END,
        },
    )

    graph.add_edge("report", END)

    # ── Compile with memory checkpointer ─────────────────────
    compiled = graph.compile(checkpointer=memory_saver)
    logger.info("langgraph_compiled", nodes=10)
    return compiled


# Singleton compiled graph
_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph


async def run_session(initial_state: dict, thread_id: str) -> dict:
    """
    Run or resume a session through the graph.
    Uses thread_id for checkpointing (allows pause/resume at gates).
    """
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    result = await graph.ainvoke(initial_state, config=config)
    return result


async def get_session_snapshot(thread_id: str):
    """Get the current state snapshot for a session (for status polling)."""
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}
    snapshot = await graph.aget_state(config)
    return snapshot
