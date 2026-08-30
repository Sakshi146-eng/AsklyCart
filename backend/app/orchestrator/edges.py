"""
Conditional edge functions for the LangGraph state machine.

Each function reads from the current state and returns the name of the next node.
"""


def route_after_gate1(state: dict) -> str:
    """After Gate 1: interested → gate2, abandoned → end, waiting → end (consent API re-invokes)"""
    if state.get("terminal_status") == "abandoned":
        return "end"
    if state.get("pending_gate") == "gate1":
        return "end"  # No user input yet — terminate run, consent API will resume with answer
    return "gate2"


def route_after_gate2(state: dict) -> str:
    """After Gate 2: under cap → payment, over cap → gate4"""
    current = state.get("current_gate")
    if current == "payment":
        return "payment"
    if current == "gate4":
        return "gate4"
    return "payment"


def route_after_gate4(state: dict) -> str:
    """After Gate 4: confirmed → payment, declined → end, waiting → end (consent API re-invokes)"""
    if state.get("terminal_status") == "abandoned":
        return "end"
    if state.get("pending_gate") == "gate4":
        return "end"  # No user input yet — terminate run, consent API will resume with answer
    return "payment"


def route_after_payment(state: dict) -> str:
    """After payment: success → report, failure → gate3"""
    current = state.get("current_gate")
    if current == "report":
        return "report"
    if current == "gate3":
        return "gate3"
    return "gate3"


def route_after_gate3(state: dict) -> str:
    """After Gate 3: retry → retry node, declined/max → end, waiting → end (consent API re-invokes)"""
    if state.get("terminal_status") == "failed":
        return "end"
    if state.get("pending_gate") == "gate3":
        return "end"  # No user input yet — terminate run, consent API will resume with answer
    current = state.get("current_gate")
    if current == "retry":
        return "retry"
    return "end"


def route_after_crosssell(state: dict) -> str:
    """After crosssell: always go to gate1 (crosssell acceptance handled externally)"""
    return "gate1"
