-- ============================================================================
-- NEVUS AI — Production PostgreSQL Schema (Supabase / Vercel Postgres)
-- Run this script once in your Supabase SQL Editor before deploying to Vercel.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Workspace State Snapshot Store (ensures full serverless state hydration across Vercel lambdas)
CREATE TABLE IF NOT EXISTS nevus_workspace_snapshots (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 3,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Relational Tables for Direct Auditing, Analytics & Multi-Service Integration
CREATE TABLE IF NOT EXISTS nevus_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'developer',
  status TEXT NOT NULL DEFAULT 'active',
  default_provider TEXT NOT NULL DEFAULT 'auto',
  default_model TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nevus_google_connections (
  user_id TEXT PRIMARY KEY REFERENCES nevus_users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  granted_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  connected_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nevus_assistants (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES nevus_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  purpose TEXT NOT NULL,
  personality TEXT NOT NULL,
  instructions TEXT NOT NULL,
  model TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nevus_conversations (
  id TEXT PRIMARY KEY,
  assistant_id TEXT NOT NULL REFERENCES nevus_assistants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES nevus_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nevus_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES nevus_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES nevus_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nevus_memories (
  id TEXT PRIMARY KEY,
  assistant_id TEXT NOT NULL REFERENCES nevus_assistants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES nevus_users(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nevus_conversations_user ON nevus_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nevus_messages_conv ON nevus_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_nevus_memories_user ON nevus_memories(user_id, assistant_id);
