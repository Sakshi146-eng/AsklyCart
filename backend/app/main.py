"""
FastAPI application entry point.
"""
import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers.session import router as session_router
from app.routers.search import router as search_router
from app.routers.consent import router as consent_router
from app.routers.audit import audit_router, catalog_router
from app.routers.browse import router as browse_router
from app.routers.auth import router as auth_router
from app.routers.user import router as user_router
from app.services.rabbitmq_client import ensure_retry_queue, close_rabbitmq
from app.services.redis_client import close_redis
from app.services.qdrant_service import ensure_collection_exists
from app.db.database import create_tables

logger = structlog.get_logger()
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("commerceops_starting", env=settings.APP_ENV)

    # Create new DB tables (users, cart_items, orders) — existing tables untouched
    try:
        create_tables()
        logger.info("db_tables_ready")
    except Exception as e:
        logger.warning("db_create_tables_warning", error=str(e))

    # Ensure Qdrant collection exists
    try:
        await ensure_collection_exists()
        logger.info("qdrant_ready")
    except Exception as e:
        logger.warning("qdrant_init_warning", error=str(e))

    # Ensure RabbitMQ retry queue exists
    try:
        await ensure_retry_queue()
        logger.info("rabbitmq_ready")
    except Exception as e:
        logger.warning("rabbitmq_init_warning", error=str(e))

    yield

    # Shutdown
    logger.info("commerceops_shutting_down")
    await close_redis()
    try:
        await close_rabbitmq()
    except Exception:
        pass


app = FastAPI(
    title="CommerceOps — AI Agentic Commerce",
    description=(
        "An AI agent that makes merchants transactable end-to-end with explainable, "
        "bounded, and gated money actions. Built for Razorpay AI Buildathon, Track 01."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────
app.include_router(session_router)
app.include_router(search_router)
app.include_router(consent_router)
app.include_router(audit_router)
app.include_router(catalog_router)
app.include_router(browse_router)
app.include_router(auth_router)
app.include_router(user_router)


# ── Health check ──────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "CommerceOps", "version": "1.0.0"}


@app.get("/", tags=["root"])
async def root():
    return {
        "service": "CommerceOps AI Agent",
        "docs": "/docs",
        "catalog": "/.well-known/catalog.json",
        "health": "/health",
    }
