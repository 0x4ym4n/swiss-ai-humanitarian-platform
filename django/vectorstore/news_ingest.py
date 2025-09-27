import os
import json
import hashlib
from typing import Any, Dict, Iterable, List, Optional, Tuple

from django.conf import settings
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# Reuse existing ingestion utilities for parity with projects pipeline
from .ingest import (
    build_embedding,
    get_qdrant as _get_qdrant,
    extract_locations,
    extract_themes,
)


DEFAULT_COLLECTION = "reliefweb_news"


def get_qdrant() -> QdrantClient:
    return _get_qdrant()


def ensure_news_collection(collection: str = DEFAULT_COLLECTION, vector_size: Optional[int] = None) -> None:
    client = get_qdrant()
    try:
        client.get_collection(collection)
        return
    except Exception:
        pass

    size = vector_size or int(getattr(settings, "EMBEDDING_DIMENSIONS", 1536))
    client.recreate_collection(
        collection_name=collection,
        vectors_config=VectorParams(size=size, distance=Distance.COSINE),
    )


def _hash_to_int(s: str) -> int:
    h = hashlib.md5(s.encode("utf-8")).hexdigest()
    # fit into signed 64-bit range for Qdrant int IDs
    return int(h, 16) % (2**63 - 1)


def _normalize_date(d: str) -> str:
    # Keep original if parsing is unreliable; the source varies in format.
    return (d or "").strip()


def iter_reliefweb_news(path: str) -> Iterable[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []
    for item in data:
        yield item


def build_news_payload(item: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    title = (item.get("title") or "").strip()
    url = (item.get("url") or "").strip()
    summary = (item.get("summary") or "").strip()
    date = _normalize_date(item.get("date") or "")
    org = (item.get("organization") or "").strip()
    details = item.get("details") or {}
    article = (details.get("article") or "").strip()
    attachments = details.get("attachments") or []

    # Compose index text similar to projects pipeline
    index_text = "\n\n".join([
        title,
        summary,
        f"Organization: {org}" if org else "",
        f"Date: {date}" if date else "",
        article,
    ]).strip()

    # Derive lightweight tags
    locations = extract_locations("\n".join([title, summary, article]))
    themes = extract_themes("\n".join([title, summary, article]))

    payload: Dict[str, Any] = {
        "title": title,
        "url": url,
        "source": "ReliefWeb",
        "organization": org,
        "date": date,
        "content_preview": (article[:400] + ("…" if len(article) > 400 else "")) if article else (summary[:400] if summary else ""),
        "locations": locations,
        "themes": themes,
        "attachments": attachments,
        # keep a copy of raw fields for traceability
        "raw": {
            "summary": summary,
        },
    }
    return index_text, payload


def upsert_news_point(collection: str, point_id: int, vector: List[float], payload: Dict[str, Any]) -> None:
    client = get_qdrant()
    client.upsert(
        collection_name=collection,
        wait=True,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)],
    )


def ingest_reliefweb_news(
    path: str,
    collection: str = DEFAULT_COLLECTION,
    limit: Optional[int] = None,
) -> Dict[str, int]:
    ensure_news_collection(collection)

    total = 0
    embedded = 0
    skipped = 0

    for i, item in enumerate(iter_reliefweb_news(path)):
        if limit is not None and i >= limit:
            break
        total += 1
        url = (item.get("url") or "").strip()
        unique_key = url or (item.get("title") or f"idx-{i}")
        point_id = _hash_to_int(unique_key)

        index_text, payload = build_news_payload(item)
        if not index_text:
            skipped += 1
            continue

        emb = build_embedding(index_text)
        if not emb:
            skipped += 1
            continue

        upsert_news_point(collection, point_id, emb, payload)
        embedded += 1

    return {"total": total, "embedded": embedded, "skipped": skipped}

