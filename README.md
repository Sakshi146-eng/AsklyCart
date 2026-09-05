# AsklyCart — AI Agentic Commerce Platform

[Features](#features) · [Architecture](#architecture) · [Getting Started](#getting-started) · [API Reference](#api-reference)

---

## Overview

AsklyCart is an AI-powered agentic commerce platform that puts the shopper in full control. It conducts structured, explainable purchase flows at scale by dynamically searching products via vector similarity, building smart carts, and routing every money action through a multi-gate human consent pipeline — all without blocking the API.


---

## Features

### For Shoppers

- **Natural Language Search** — Ask for anything in plain English; the agent returns semantically matched products via Qdrant vector search
- **AI-Built Cart** — Agent shortlists the best product and auto-builds the cart based on your query intent
- **Adaptive Cross-Sell** — After cart build, the agent suggests complementary products or combo deals at a discounted price
- **Order History** — Every completed purchase is persisted to the database and visible on the Orders page with full line items
- **Persistent Cart** — Cart state survives page reloads and sessions via server-side storage
- **Instant Feedback** — Full audit report with AI reasoning shown on purchase completion

### For Operators (Bounded AI Commerce)

- **Multi-Gate Consent Pipeline** — Four explicit human approval checkpoints before any payment fires:
  - **Gate 1** — Interest confirmation ("Do you want to buy this?")
  - **Gate 2** — Auto-approval if total ≤ spending cap; escalates to Gate 4 if over cap
  - **Gate 4** — Explicit over-cap authorization with clear amount displayed
  - **Gate 3** — Retry consent after payment failure (with remaining attempts shown)
- **Spending Cap Enforcement** — Every user account has a configurable `spending_cap`; over-cap purchases require explicit manual consent
- **Max Retry Limit** — Payment retries are capped (configurable); on exhaustion the pipeline auto-declines and the session closes cleanly
- **Immutable Audit Trail** — Every gate decision, AI reasoning, and consent token is written to the database for full traceability
- **JWT Consent Tokens** — Each gate decision is cryptographically signed, binding the user's decision to the exact session, amount, and product IDs

### Platform Intelligence

- **Dual-Vector Search** — Qdrant stores product embeddings; queries return semantically matched products, combo matches, and related alternatives in a single call
- **Event-Driven Payment** — RabbitMQ decouples Razorpay payment calls and retry jobs from the live agent session; no request timeout on slow payment gateways
- **LangGraph Orchestration** — The full shopping pipeline (search → cart → gate1 → gate2/4 → payment → gate3/retry → crosssell → report) runs as a stateful LangGraph graph
- **AI Reasoning at Every Step** — Groq LLM generates a human-readable "why" explanation for every gate decision and audit entry
- **Theme Support** — Full light/dark mode with system preference detection

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI, Python 3.11+ |
| Frontend | React 18, Vite, TypeScript |
| Database | PostgreSQL 15 (asyncpg + SQLAlchemy async) |
| Vector Store | Qdrant (product semantic search) |
| Message Broker | RabbitMQ (payment retry queue) |
| Cache + State | Redis 7 (session store, agent state) |
| AI / LLM | Groq API — LLaMA 3.3 70B Versatile |
| Agent Framework | LangGraph (stateful multi-node pipeline) |
| Payment Gateway | Razorpay (test mode) |
| Auth | JWT HS256 (python-jose) + bcrypt |
| Containerization | Docker + Docker Compose |

---

## Architecture

```
+-----------------------------------------------------------------------------+
|  Client (React SPA + TypeScript)                                            |
|  Landing · Search · Cart · Orders · Profile · Auth                         |
+----------------------------------+------------------------------------------+
                                   |  REST / JSON  (JWT Bearer)
+----------------------------------v------------------------------------------+
|  FastAPI Backend  :8000                                                     |
|                                                                             |
|  +------------------+  +--------------------------------+  +-------------+  |
|  |  Middleware       |  |  Routers                       |  |  Auth       |  |
|  |  1. CORS          |  |  /api/auth  /api/browse        |  |  JWT dep    |  |
|  |  2. Lifespan      |  |  /api/session  /api/consent    |  |  bcrypt     |  |
|  |  3. DB Init       |  |  /api/user  /api/audit         |  +-------------+  |
|  +------------------+  +----------------+---------------+                  |
+-------------------------------------------+---------------------------------+
                                            |
          +---------------------------------+-----------------------------+
          |                                |                             |
+---------v-----------+       +------------v-------------+   +----------v---------+
|  PostgreSQL  :5432  |       |  LangGraph Agent Pipeline |   |  Qdrant  :6333     |
|  users              |       |                           |   |  product_embeddings|
|  cart_items         |       |  search_node              |   |  vector similarity |
|  orders             |       |  -> cart_node             |   |  semantic search   |
|  audit_log          |       |  -> gate1_node            |   +--------------------+
+---------------------+       |  -> gate2_node            |
                              |  -> gate4_node (over-cap) |
                              |  -> payment_node          |
                              |  -> gate3_node (retry)    |
                              |  -> retry_node            |
                              |  -> crosssell_node        |
                              |  -> report_node           |
                              +---------------+-----------+
                                              |  publish retry jobs
+---------------------------------------------v------------------------------+
|  RabbitMQ  :5672                                                           |
|  payment_retry_queue ------------> Retry Worker --> Razorpay API           |
+----------------------------------------------------------------------------+
                                              |
                           LangGraph state persisted via
                                              v
+------------------------------------------------------+
|  Redis  :6379                                        |
|  1. Session Store  session:{id} -> agent state JSON  |
|  2. Consent state  pending_gate, consent_history     |
|  3. Cart cache     user cart between requests        |
+------------------------------------------------------+
```

---

## Agent Pipeline

```
POST /api/session/start
|
+-- VectorSearch (Qdrant) -> matched, combo, alternatives
+-- CartNode -> shortlist best product, build cart
|
+-- Gate 1  -- pending_gate: "gate1" --> PAUSE (await user consent via /api/consent)
|    YES --> Gate 2
|    NO  --> terminal_status: "abandoned"
|
+-- Gate 2  (auto, no user prompt)
|    total <= cap --> PaymentNode
|    total > cap  --> Gate 4
|
+-- Gate 4  -- pending_gate: "gate4" --> PAUSE
|    YES --> PaymentNode
|    NO  --> terminal_status: "abandoned"
|
+-- PaymentNode  (Razorpay)
|    success --> CrossSellNode --> ReportNode --> terminal_status: "completed"
|    failure --> Gate 3
|
+-- Gate 3  -- pending_gate: "gate3" --> PAUSE
     YES (retries remaining) --> RetryNode --> RabbitMQ --> PaymentNode
     YES (max retries hit)   --> terminal_status: "failed" (auto-declined)
     NO                      --> terminal_status: "failed"
```

---

## Project Structure

```
AsklyCart/
+-- backend/
|   +-- app/
|       +-- config.py              # Pydantic Settings (env-driven)
|       +-- main.py                # App factory, lifespan, CORS, DB init
|       +-- db/
|       |   +-- database.py        # Async SQLAlchemy + asyncpg session
|       +-- models/
|       |   +-- db_models.py       # SQLAlchemy ORM (users, cart_items, orders, audit_log)
|       +-- orchestrator/
|       |   +-- graph.py           # LangGraph graph definition + run_session()
|       |   +-- state.py           # AgentState TypedDict
|       |   +-- edges.py           # Conditional edge routing functions
|       |   +-- audit_writer.py    # Audit log persistence helper
|       |   +-- nodes/
|       |       +-- search.py      # Qdrant vector search node
|       |       +-- cart.py        # Cart build + product selection node
|       |       +-- gates.py       # Gate 1, Gate 2, Gate 4, Gate 3 nodes
|       |       +-- payment.py     # Razorpay payment node
|       |       +-- retry.py       # RabbitMQ retry publisher node
|       |       +-- crosssell.py   # Cross-sell suggestion node
|       |       +-- report.py      # Final audit report generator node
|       +-- routers/
|       |   +-- auth.py            # /api/auth (register, login, me)
|       |   +-- session.py         # /api/session/start
|       |   +-- consent.py         # /api/consent (gate decision submission)
|       |   +-- browse.py          # /api/browse (product search, no agent)
|       |   +-- user.py            # /api/user (cart, orders — auth required)
|       |   +-- audit.py           # /api/audit (session audit trail)
|       +-- services/
|           +-- qdrant_service.py   # Qdrant client + semantic search helpers
|           +-- groq_client.py      # Groq LLM client (reason generation)
|           +-- razorpay_client.py  # Razorpay payment + capture helpers
|           +-- redis_client.py     # Redis session state (get/set/record)
|           +-- rabbitmq_client.py  # RabbitMQ publish + consume (retry jobs)
|           +-- jwt_service.py      # Consent JWT sign + verify
|           +-- auth_service.py     # bcrypt hash + verify
|           +-- crosssell_service.py# Cross-sell scoring and ranking
|           +-- email_service.py    # Order confirmation email (optional)
+-- frontend/
|   +-- src/
|   |   +-- pages/
|   |   |   +-- LandingPage.tsx    # Hero, features, CTA
|   |   |   +-- SearchPage.tsx     # Main agent flow: search -> gates -> receipt
|   |   |   +-- CartPage.tsx       # Persistent cart (from DB)
|   |   |   +-- OrdersPage.tsx     # Order history
|   |   |   +-- ProfilePage.tsx    # User profile + spending cap display
|   |   |   +-- AuthPage.tsx       # Login / Register
|   |   |   +-- ProductPage.tsx    # Single product detail view
|   |   +-- components/
|   |   |   +-- Navbar.tsx         # Top nav with cart badge, theme toggle
|   |   |   +-- ProductCard.tsx    # Product grid card
|   |   |   +-- AgentFlowPanel.tsx # Live stage progress tracker
|   |   |   +-- GateModal.tsx      # Gate consent dialog
|   |   |   +-- CrossSellBanner.tsx# Cross-sell suggestion UI
|   |   |   +-- AuditTrail.tsx     # Expandable audit log viewer
|   |   |   +-- Cart.tsx           # Inline cart component
|   |   +-- context/
|   |   |   +-- AuthContext.tsx    # JWT + user state (React context)
|   |   |   +-- ThemeContext.tsx   # Light/dark theme context
|   |   +-- api/
|   |       +-- client.ts          # Typed API client (fetch + JWT interceptor)
|   +-- index.html
+-- docker-compose.yml             # 6-service orchestration
+-- Dockerfile                     # Backend image (python:3.11-slim)
+-- requirements.txt
+-- seed.py                        # Product catalog seeder (Qdrant + PostgreSQL)
+-- init.sql                       # PostgreSQL schema bootstrap
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker 20.10+ and Docker Compose v2

### Environment Variables

Create a `.env` file in the project root:

```env
# Groq LLM
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# Razorpay (use test keys)
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret

# JWT
JWT_SECRET_KEY=your_very_long_random_secret_key_here

# Database (Docker defaults shown — change for production)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=asklycart_db

# Redis
REDIS_URL=redis://redis:6379/0

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/

# Qdrant
QDRANT_URL=http://qdrant:6333

# Agent limits
MAX_RETRY_ATTEMPTS=2
DEFAULT_SPENDING_CAP=2000.0

# Set to True to force payment failure (for testing gate3 flow)
FORCE_PAYMENT_FAIL=False
```

<!-- | Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Required for AI reasoning at each gate |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | LLM model for gate reasoning and reports |
| `RAZORPAY_KEY_ID` | — | Razorpay test key (from dashboard) |
| `RAZORPAY_KEY_SECRET` | — | Razorpay test secret |
| `JWT_SECRET_KEY` | auto-generated | Change in production |
| `MAX_RETRY_ATTEMPTS` | `2` | Max payment retry attempts before pipeline declines |
| `DEFAULT_SPENDING_CAP` | `2000.0` | Per-user auto-approve cap in INR |
| `FORCE_PAYMENT_FAIL` | `False` | Set `True` to always fail payment (tests gate3 retry flow) | -->

---

## Docker

```bash
git clone https://github.com/your-org/AsklyCart.git
cd AsklyCart
cp .env.example .env        # Edit .env — set GROQ_API_KEY and Razorpay keys at minimum
docker-compose up --build
```

All 6 services start automatically:

| Service | URL |
|---|---|
| Frontend (React) | http://localhost:3000 |
| API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |
| RabbitMQ Management | http://localhost:15672 |
| Qdrant Dashboard | http://localhost:6333/dashboard |
| Redis | localhost:6379 |

After containers are up, seed the product catalog:

```bash
docker exec -it asklycart_app python seed.py
```

---

**3. Frontend**

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

---

### Testing the Payment Failure Flow

To test Gate 3 (retry consent) and max-retries pipeline termination:

```env
# In .env
FORCE_PAYMENT_FAIL=True
```

With this set, every payment attempt will fail, triggering:
1. Gate 3 dialog — "Payment failed. Would you like to retry? (2 attempts remaining)"
2. On "Yes" → retry queued via RabbitMQ → fails again → Gate 3 re-shown
3. After `MAX_RETRY_ATTEMPTS` failures → pipeline auto-declines, session closes, user redirected to Search

---

## API Reference

FastAPI auto-generates interactive documentation:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Endpoints Summary

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Health check |
| `POST` | `/api/auth/register` | — | Register new user account |
| `POST` | `/api/auth/login` | — | Authenticate and receive JWT |
| `GET` | `/api/auth/me` | ✅ | Get current user profile |
| `POST` | `/api/browse` | — | Search products (no agent, instant results) |
| `POST` | `/api/session/start` | ✅ | Start agent pipeline for a product query |
| `GET` | `/api/session/{id}` | ✅ | Poll current agent state + pending gate |
| `POST` | `/api/consent` | ✅ | Submit gate decision (yes/no) |
| `GET` | `/api/audit/{session_id}` | ✅ | Full audit trail for a session |
| `GET` | `/api/user/cart` | ✅ | Get user persistent cart |
| `POST` | `/api/user/cart` | ✅ | Add item to cart |
| `DELETE` | `/api/user/cart` | ✅ | Clear entire cart |
| `GET` | `/api/user/orders` | ✅ | Get order history |
| `POST` | `/api/user/orders` | ✅ | Record completed order |

---

