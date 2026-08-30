-- CommerceOps PostgreSQL Initialization Script
-- Creates all tables needed for the application

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Products table (source of truth for /.well-known/catalog.json)
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    category TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    embedding_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log table — the centerpiece of the submission
-- Every gate, payment attempt, and retry writes one row here
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    step TEXT NOT NULL CHECK (step IN (
        'search',
        'cart',
        'crosssell',
        'gate1',
        'gate2',
        'gate4',
        'payment_attempt',
        'gate3',
        'retry',
        'report',
        'final_status'
    )),
    decision TEXT,
    reason TEXT,
    amount NUMERIC(10, 2),
    consent_token TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast session-based audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_step ON audit_log(step);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Sessions table for tracking active sessions
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_email TEXT,
    spending_cap NUMERIC(10, 2) NOT NULL DEFAULT 2000.00,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
