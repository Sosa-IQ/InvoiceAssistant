import logging
from dataclasses import dataclass
from datetime import datetime
import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.openai_service import OpenAIService

logger = logging.getLogger(__name__)


@dataclass
class VectorHit:
    text: str
    filename: str
    doc_id: str
    chunk_index: int
    distance: float


class VectorStoreService:
    """Store and query invoice embeddings in Supabase Postgres via pgvector."""

    def __init__(self, openai_service: OpenAIService) -> None:
        self.openai = openai_service

    @staticmethod
    def _vector_literal(values: list[float]) -> str:
        return json.dumps(values, separators=(",", ":"))

    async def add_document(
        self,
        db: AsyncSession,
        *,
        doc_id: str,
        user_id: str,
        invoice_record_id: int,
        filename: str,
        chunks: list[str],
    ) -> None:
        if not chunks:
            return

        embeddings = self.openai.embed_texts(chunks)
        statement = text(
            """
            INSERT INTO invoice_embeddings (
                doc_id,
                user_id,
                invoice_record_id,
                filename,
                chunk_index,
                content,
                embedding
            )
            VALUES (
                CAST(:doc_id AS UUID),
                CAST(:user_id AS UUID),
                :invoice_record_id,
                :filename,
                :chunk_index,
                :content,
                CAST(:embedding AS extensions.vector)
            )
            ON CONFLICT (doc_id, chunk_index)
            DO UPDATE SET
                invoice_record_id = EXCLUDED.invoice_record_id,
                filename = EXCLUDED.filename,
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding
            """
        )

        for chunk_index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
            await db.execute(
                statement,
                {
                    "doc_id": doc_id,
                    "user_id": user_id,
                    "invoice_record_id": invoice_record_id,
                    "filename": filename,
                    "chunk_index": chunk_index,
                    "content": chunk,
                    "embedding": self._vector_literal(embedding),
                },
            )

        logger.info(
            "Stored %d embedded chunks in Supabase for doc_id=%s at %s",
            len(chunks),
            doc_id,
            datetime.utcnow().isoformat(),
        )

    async def query(
        self,
        db: AsyncSession,
        *,
        query_text: str,
        user_id: str,
        n_results: int = 5,
        distance_threshold: float = 0.8,
    ) -> list[VectorHit]:
        embedding = self.openai.embed_texts([query_text])[0]
        result = await db.execute(
            text(
                """
                SELECT
                    content,
                    filename,
                    doc_id::text AS doc_id,
                    chunk_index,
                    embedding <=> CAST(:embedding AS extensions.vector) AS distance
                FROM invoice_embeddings
                WHERE user_id = CAST(:user_id AS UUID)
                ORDER BY embedding <=> CAST(:embedding AS extensions.vector)
                LIMIT :limit
                """
            ),
            {
                "embedding": self._vector_literal(embedding),
                "user_id": user_id,
                "limit": n_results,
            },
        )

        hits: list[VectorHit] = []
        for row in result.mappings():
            distance = float(row["distance"])
            if distance <= distance_threshold:
                hits.append(
                    VectorHit(
                        text=row["content"],
                        filename=row["filename"],
                        doc_id=row["doc_id"],
                        chunk_index=row["chunk_index"],
                        distance=distance,
                    )
                )
        return hits

    async def delete_document(self, db: AsyncSession, *, doc_id: str, user_id: str) -> None:
        await db.execute(
            text(
                """
                DELETE FROM invoice_embeddings
                WHERE doc_id = CAST(:doc_id AS UUID)
                  AND user_id = CAST(:user_id AS UUID)
                """
            ),
            {"doc_id": doc_id, "user_id": user_id},
        )
        logger.info("Deleted Supabase vector chunks for doc_id=%s user_id=%s", doc_id, user_id)
