import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, Numeric, Text, DateTime, JSON, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String, nullable=False, index=True)
    step = Column(String, nullable=False, index=True)
    decision = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    amount = Column(Numeric(10, 2), nullable=True)
    consent_token = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    category = Column(String, nullable=False)
    stock = Column(String, nullable=False, default=0)
    description = Column(Text, nullable=True)
    embedding_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"

    session_id = Column(String, primary_key=True)
    user_email = Column(String, nullable=True)
    spending_cap = Column(Numeric(10, 2), nullable=False, default=2000.00)
    status = Column(String, nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


# ── New models for user auth, cart, and orders ──────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(Text, nullable=False)
    spending_cap = Column(Numeric(10, 2), nullable=False, default=2000.00)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class CartItem(Base):
    __tablename__ = "cart_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String(255), nullable=False)
    product_name = Column(String(500), nullable=False)
    product_price = Column(Numeric(10, 2), nullable=False)
    product_category = Column(String(255), nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    added_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(255), nullable=True)
    items = Column(JSON, nullable=False, default=list)
    total = Column(Numeric(10, 2), nullable=False, default=0)
    status = Column(String(100), nullable=False, default="completed")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
