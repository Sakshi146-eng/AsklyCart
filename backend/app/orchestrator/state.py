"""
LangGraph Agent State definition.

Every piece of data the orchestrator needs to carry through the flow lives here.
The state is immutable between nodes — each node returns a partial update dict.
"""
from typing import TypedDict, Optional, Annotated
import operator


class CartItem(TypedDict):
    id: str
    name: str
    price: float
    category: str
    stock: int
    description: str
    quantity: int


class AuditEntry(TypedDict):
    step: str
    decision: str
    reason: str
    amount: Optional[float]
    consent_token: Optional[str]
    created_at: str


class ConsentRecord(TypedDict):
    gate: str
    decision: str
    token: str


class CrossSellSuggestion(TypedDict):
    type: str           # "combo_discount" | "complementary" | "better_alternative" | "cheaper_alternative"
    product: dict
    combo_price: Optional[float]
    combo_label: Optional[str]
    with_product_id: Optional[str]


class AgentState(TypedDict):
    # Session identity
    session_id: str
    user_email: Optional[str]

    # Search context
    query: str
    parsed_query: dict
    search_results: list[dict]

    # Cart
    cart: list[CartItem]
    spending_cap: float

    # Cross-sell
    cross_sell_suggestions: list[CrossSellSuggestion]
    cross_sell_shown: bool
    cross_sell_accepted: bool

    # Gate state
    current_gate: str
    consent_history: list[ConsentRecord]

    # Payment
    payment_result: Optional[dict]
    retry_count: int
    order_id: Optional[str]
    payment_id: Optional[str]

    # Report
    report_text: Optional[str]
    email_sent: bool

    # Audit trail (accumulated across all nodes)
    audit_trail: list[AuditEntry]

    # Terminal status
    terminal_status: Optional[str]   # "completed" | "abandoned" | "failed"
    error_message: Optional[str]

    # Gate pending user input (used for SSE + consent API)
    pending_gate: Optional[str]      # Set when the flow pauses waiting for user
    gate_prompt: Optional[str]       # Human-readable prompt shown to user at the gate
