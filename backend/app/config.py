from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "CommerceOps"
    APP_ENV: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "change-me-in-production"

    # Groq LLM
    GROQ_API_KEY: str
    GROQ_MODEL_A: str = "qwen/qwen3.8-27b"          # Parsing — best token limits (2M/day)
    GROQ_MODEL_B: str = "openai/gpt-oss-120b"        # Reasoning — largest available model

    # Google Gemini (embeddings)
    GOOGLE_API_KEY: str
    GEMINI_EMBEDDING_MODEL: str = "models/text-embedding-004"

    # PostgreSQL
    DATABASE_URL: str = "postgresql+asyncpg://commerceops:commerceops@postgres:5432/commerceops"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # RabbitMQ
    RABBITMQ_URL: str = "amqp://guest:guest@rabbitmq:5672/"
    RABBITMQ_RETRY_QUEUE: str = "payment_retry"

    # Qdrant
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_COLLECTION: str = "products"

    # Razorpay (test mode)
    RAZORPAY_KEY_ID: str
    RAZORPAY_KEY_SECRET: str

    # JWT
    JWT_SECRET: str = "jwt-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60

    # Email (SMTP)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "CommerceOps <noreply@commerceops.ai>"

    # Business rules
    DEFAULT_SPENDING_CAP: float = 2000.0
    MAX_RETRY_ATTEMPTS: int = 2

    # Debug flag: set to 1 to force payment failures (useful for testing Gate 3 / retry flow)
    FORCE_PAYMENT_FAIL: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
