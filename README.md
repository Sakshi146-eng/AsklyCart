# AsklyCart — AI Agentic Commerce


An end-to-end AI commerce agent that makes a merchant transactable by an AI buyer — with explainable, bounded, and gated money actions and a full audit trail.

---

## Quick Start

### 1. Prerequisites
- Docker + Docker Compose
- API keys: Groq, Google (Gemini), Razorpay (test mode)
- Gmail account with 2FA and App Password (for email receipts)

### 2. Configure
```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Launch
```bash
docker compose up --build
```
Everything starts in the correct order (Postgres → Redis → RabbitMQ → Qdrant → App). The app container automatically runs `seed.py` on startup to embed all 20 products into Qdrant and Postgres.

### 4. Access
| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8000 |
| **API Docs** | http://localhost:8000/docs |
| **Agent Catalog** | http://localhost:8000/.well-known/catalog.json |
| **RabbitMQ Management** | http://localhost:15672 (guest/guest) |

---

## Architecture

```
React Frontend (Vite, port 3000)
    ↓
FastAPI Backend (port 8000)
  ├── LangGraph Orchestrator (10-node state machine)
  │     ├── search    → Groq Model A → Qdrant vector search
  │     ├── cart      → Redis session
  │     ├── crosssell → get_related_products() → mock JSON
  │     ├── gate1     → Groq Model B → PostgreSQL audit_log + JWT
  │     ├── gate2     → Groq Model B → audit_log + JWT (auto-approve or escalate)
  │     ├── gate4     → Groq Model B → audit_log + JWT (over-cap consent)
  │     ├── payment   → Razorpay test API → audit_log
  │     ├── gate3     → Groq Model B → audit_log + JWT (retry consent)
  │     ├── retry     → RabbitMQ queue
  │     └── report    → Groq Model B → SMTP email receipt
  └── GET /.well-known/catalog.json (agent-readable manifest)

PostgreSQL — audit_log table (explainability centerpiece)
Redis       — session/cart/gate state
RabbitMQ    — payment_retry queue (inspectable at :15672)
Qdrant      — product vector store (Google text-embedding-004)
```

---

## The Agent Flow

```
Search Query
    ↓ [Model A: parse query → Qdrant search (≥2 param match)]
Product shortlisted → Cart
    ↓ [get_related_products() → cross-sell/combo offer]
Gate 1 — User Interest?
    No → LOG: abandoned
    Yes ↓
Gate 2 — Price ≤ Cap?
    Yes → AUTO-APPROVE + JWT → Payment
    No  ↓
Gate 4 — Over-cap consent?
    No  → LOG: abandoned
    Yes → Payment
        ↓
    Success → Model B report → Email receipt → LOG: completed
    Failure → Gate 3 — Retry?
        No  → LOG: failed (terminal)
        Yes → RabbitMQ queue → retry (max 2) → back to Payment
              After 2 retries → LOG: terminal failure
```

---

## Key Design Decisions

### Dual Groq Model Split
- **Model A** (`llama-3.1-8b-instant`): Fast, cheap query parsing → structured JSON
- **Model B** (`llama-3.3-70b-versatile`): Thoughtful reason generation for every audit log entry

These are two distinct calls, never merged. This is what makes the audit trail _explainable_ rather than a black box.

### JWT Consent Tokens
Every gate decision (Gate 1, 2, 4, 3) generates a signed JWT binding the consent to:
- `session_id`, `gate`, `amount`, `product_ids`, `decision`, `iat/exp`

Stored alongside each audit_log row — tamper-evident proof of consent, not just a boolean.

### Cross-sell Service
`get_related_products(product_id) -> list[dict]` has a stable, stable interface:
1. Combo-discount pairings returned **first**
2. Then better/cheaper alternatives
3. Then complementary products

This is the Phase 2 Neo4j swap point — replace the function body, keep the signature.

### Retry Cap
Max 2 retries enforced in two places: Gate 3 node (auto-stops at cap) and the retry count in state. After 2 failures, the agent stops, logs a terminal failure, and tells the user — no infinite loops.

---

## Audit Log Schema

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    session_id TEXT NOT NULL,
    step TEXT NOT NULL,  -- search|cart|crosssell|gate1|gate2|gate4|payment_attempt|gate3|retry|report|final_status
    decision TEXT,       -- what happened (approved, failed, abandoned, etc.)
    reason TEXT,         -- Model B generated human-readable explanation
    amount NUMERIC,      -- transaction amount (nullable)
    consent_token TEXT,  -- JWT token for gate consent (nullable)
    metadata JSONB,      -- additional context
    created_at TIMESTAMPTZ
);
```

Query all sessions:
```bash
docker exec commerceops_postgres psql -U commerceops -c "SELECT step, decision, reason, amount FROM audit_log ORDER BY created_at;"
```

---

## Demo Script

1. **Start**: `docker compose up`
2. **Open**: http://localhost:3000
3. **Session setup**: enter email + spending cap (default ₹2000)
4. **Search**: "TurboSteel bottle at ₹500"
5. **Cross-sell**: Accept the combo offer (bottle + cleaner at ₹599)
6. **Gate 1**: Click "Yes, I'm Interested"
7. **Gate 2**: If total ≤ ₹2000 → auto-approved. If > ₹2000 → Gate 4 appears
8. **Payment**: Success → check email for receipt
9. **Retry flow**: Set `FORCE_PAYMENT_FAIL=True` in `.env`, restart app → Gate 3 appears → inspect http://localhost:15672 (RabbitMQ)
10. **Audit**: `curl http://localhost:8000/api/session/{session_id}/audit`
11. **Catalog**: `curl http://localhost:8000/.well-known/catalog.json`

---

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key |
| `GOOGLE_API_KEY` | Google API key (Gemini embeddings) |
| `RAZORPAY_KEY_ID` | Razorpay test-mode Key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay test-mode Key Secret |
| `JWT_SECRET` | Secret for signing consent JWTs |
| `SMTP_USER` / `SMTP_PASSWORD` | Gmail + App Password for receipts |
| `FORCE_PAYMENT_FAIL` | Set `True` to demo Gate 3 / retry flow |
| `DEFAULT_SPENDING_CAP` | Default auto-approve cap in ₹ (default: 2000) |
| `MAX_RETRY_ATTEMPTS` | Max payment retries (default: 2) |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Orchestrator | LangGraph (StateGraph, 10 nodes) |
| LLM A (query) | Groq llama-3.1-8b-instant |
| LLM B (reason) | Groq llama-3.3-70b-versatile |
| Embeddings | Google text-embedding-004 |
| Vector Search | Qdrant |
| Payment | Razorpay test-mode |
| Retry Queue | RabbitMQ (aio-pika) |
| Audit Log | PostgreSQL (SQLAlchemy async) |
| Session State | Redis |
| Consent Proof | JWT (PyJWT, HS256) |
| Email | SMTP (aiosmtplib) |
| Backend | FastAPI + Uvicorn |
| Frontend | React + Vite + TypeScript |
| Containerization | Docker + Docker Compose |
