-- Performance indexes for high-frequency query paths
-- Safe to run on existing production DB: all statements use IF NOT EXISTS

-- messages.conversation_id — most-queried FK in the entire system
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON messages (conversation_id);

-- conversations.tenant_id — every tenant-scoped list query
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id
  ON conversations (tenant_id);

-- conversations.customer_id — customer conversation lookups
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id
  ON conversations (customer_id);

-- ai_suggestions.conversation_id — pending suggestion lookups
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_conversation_id
  ON ai_suggestions (conversation_id);

-- escalation_events.conversation_id — escalation lookups per conversation
CREATE INDEX IF NOT EXISTS idx_escalation_events_conversation_id
  ON escalation_events (conversation_id);

-- rag_chunks.rag_document_id — RAG retrieval by document
CREATE INDEX IF NOT EXISTS idx_rag_chunks_rag_document_id
  ON rag_chunks (rag_document_id);

-- learning_queue.conversation_id — unique; enables safe upsert via ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_queue_conversation_id
  ON learning_queue (conversation_id);
