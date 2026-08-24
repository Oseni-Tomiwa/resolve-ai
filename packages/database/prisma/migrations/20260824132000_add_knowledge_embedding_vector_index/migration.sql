-- Semantic search uses cosine distance via the <=> operator.
-- pgvector must be installed by the preceding knowledge-embeddings migration.
CREATE INDEX "KnowledgeEmbedding_embedding_hnsw_idx"
ON "KnowledgeEmbedding" USING hnsw ("embedding" vector_cosine_ops);
