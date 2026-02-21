import logging

from app.services.vector_store import VectorStoreService

logger = logging.getLogger(__name__)


class RAGService:
    """
    Retrieves relevant invoice chunks from ChromaDB and formats a context block
    suitable for inclusion in an OpenAI prompt.
    """

    def __init__(self, vector_store: VectorStoreService) -> None:
        self.vector_store = vector_store

    def get_context(self, prompt: str, max_docs: int = 3) -> tuple[str, int]:
        """
        Query ChromaDB for the most relevant chunks, deduplicate by source
        document, and return a formatted context string.

        Args:
            prompt: The user's invoice description.
            max_docs: Maximum number of unique source documents to include.

        Returns:
            (context_text, num_unique_docs_used)
        """
        hits = self.vector_store.query(prompt, n_results=5)
        if not hits:
            return "", 0

        # Deduplicate: one entry per doc_id, preserving relevance order
        seen: set[str] = set()
        unique_hits: list[dict] = []
        for hit in hits:
            doc_id = hit["metadata"].get("doc_id", "")
            if doc_id not in seen:
                seen.add(doc_id)
                unique_hits.append(hit)
            if len(unique_hits) >= max_docs:
                break

        parts = []
        for i, hit in enumerate(unique_hits, start=1):
            filename = hit["metadata"].get("filename", "unknown")
            parts.append(f"[Document {i} — {filename}]\n{hit['text']}")

        context = "\n\n---\n\n".join(parts)
        logger.info("RAG returned %d unique docs for prompt.", len(unique_hits))
        return context, len(unique_hits)
