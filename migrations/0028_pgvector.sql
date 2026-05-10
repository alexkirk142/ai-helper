-- Включить расширение pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Добавить векторный столбец (3072 = text-embedding-3-large)
ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(3072);

-- Заполнить из существующего TEXT-поля
UPDATE rag_chunks
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL AND embedding_vector IS NULL;

-- Индекс для приближённого поиска (HNSW быстрее IVFFlat при < 1M строк)
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_vector
  ON rag_chunks USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
