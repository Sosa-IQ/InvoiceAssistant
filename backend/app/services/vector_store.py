import logging

import chromadb

from app.config import settings

logger = logging.getLogger(__name__)

COLLECTION_NAME = "invoices"


class VectorStoreService:
    """
    Wraps ChromaDB for storing and querying invoice embeddings.

    Must be instantiated once at app startup and reused across requests.
    Uses ChromaDB's default embedding function (all-MiniLM-L6-v2).
    On first run, the model (~90MB) is downloaded automatically.
    """

    def __init__(self) -> None:
        logger.info("Initializing ChromaDB at %s", settings.chroma_dir)
        self.client = chromadb.PersistentClient(path=str(settings.chroma_dir))
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            # Default embedding function = sentence-transformers all-MiniLM-L6-v2
        )
        logger.info(
            "ChromaDB ready. Collection '%s' has %d documents.",
            COLLECTION_NAME,
            self.collection.count(),
        )

    def warmup(self) -> None:
        """
        Force the embedding model to download/load on startup.
        Prevents a slow first-request experience.
        """
        logger.info(
            "Warming up embedding model (may download ~90MB on first run)..."
        )
        try:
            self.collection.query(query_texts=["warmup"], n_results=1)
            logger.info("Embedding model ready.")
        except Exception:
            # Collection may be empty on first run — that's fine
            logger.info("Embedding model ready (collection is empty).")

    def add_document(
        self,
        doc_id: str,
        chunks: list[str],
        metadata: dict,
    ) -> None:
        """
        Embed and store all chunks for a single document.

        Args:
            doc_id: Unique document identifier (UUID).
            chunks: List of text chunks from the document.
            metadata: Shared metadata dict for all chunks (filename, etc.).
        """
        if not chunks:
            return

        ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
        metadatas = [
            {**metadata, "doc_id": doc_id, "chunk_index": i}
            for i in range(len(chunks))
        ]

        self.collection.add(
            documents=chunks,
            metadatas=metadatas,
            ids=ids,
        )
        logger.info("Added %d chunks for doc_id=%s", len(chunks), doc_id)

    def query(
        self,
        query_text: str,
        n_results: int = 5,
        distance_threshold: float = 0.8,
    ) -> list[dict]:
        """
        Retrieve the most similar chunks for a query string.

        Returns:
            List of dicts with keys: text, metadata, distance.
            Filtered to distance <= distance_threshold.
        """
        count = self.collection.count()
        if count == 0:
            return []

        actual_n = min(n_results, count)
        results = self.collection.query(
            query_texts=[query_text],
            n_results=actual_n,
            include=["documents", "metadatas", "distances"],
        )

        hits = []
        documents = results["documents"][0]
        metadatas = results["metadatas"][0]
        distances = results["distances"][0]

        for doc, meta, dist in zip(documents, metadatas, distances):
            if dist <= distance_threshold:
                hits.append({"text": doc, "metadata": meta, "distance": dist})

        return hits

    def delete_document(self, doc_id: str) -> None:
        """Remove all chunks belonging to a document."""
        self.collection.delete(where={"doc_id": doc_id})
        logger.info("Deleted all chunks for doc_id=%s", doc_id)

    def count(self) -> int:
        return self.collection.count()
