import logging
import os
import requests
from typing import List, Optional

from .rate_limiter import get_rate_limiter

EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))
logger = logging.getLogger(__name__)

DEEPINFRA_API_KEY = os.environ.get("DEEPINFRA_API_KEY", "")
DEEPINFRA_EMBEDDINGS_URL = "https://api.deepinfra.com/v1/openai/embeddings"
DEEPINFRA_MODEL = os.environ.get("DEEPINFRA_MODEL", "Qwen/Qwen3-Embedding-0.6B")


def _get_requests_per_second(default: int = 20) -> int:
    try:
        value = int(os.environ.get("QWEN_EMBED_REQUESTS_PER_SECOND", default))
        if value > 0:
            return value
    except Exception:
        pass
    return default


_QWEN_EMBED_RATE_LIMITER = get_rate_limiter(
    name="qwen_embeddings",
    max_calls=_get_requests_per_second(),
    period=1.0,
)


def get_qwen_embeddings(text: str, max_retries: int = 3) -> Optional[List[float]]:
    if len(text) > 8000:
        text = text[:8000] + "..."

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPINFRA_API_KEY}"
    }
    payload = {"input": text, "model": DEEPINFRA_MODEL, "encoding_format": "float"}

    for attempt in range(max_retries):
        try:
            _QWEN_EMBED_RATE_LIMITER.acquire()
            resp = requests.post(DEEPINFRA_EMBEDDINGS_URL, headers=headers, json=payload, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if 'data' in data and data['data'] and 'embedding' in data['data'][0]:
                    emb = data['data'][0]['embedding']
                    if len(emb) == EMBEDDING_DIMENSIONS:
                        return emb
                    if len(emb) < EMBEDDING_DIMENSIONS:
                        emb.extend([0.0] * (EMBEDDING_DIMENSIONS - len(emb)))
                        return emb
                    return emb[:EMBEDDING_DIMENSIONS]
        except Exception:
            pass
    return None

