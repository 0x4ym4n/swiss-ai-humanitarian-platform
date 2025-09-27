import os
from typing import List, Optional
import requests

from .rate_limiter import get_rate_limiter


OPENAI_EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_EMBED_URL = os.environ.get("OPENAI_EMBED_URL", "https://api.openai.com/v1/embeddings")


def _get_requests_per_second(default: int = 20) -> int:
    try:
        value = int(os.environ.get("OPENAI_EMBED_REQUESTS_PER_SECOND", default))
        if value > 0:
            return value
    except Exception:
        pass
    return default


_OPENAI_EMBED_RATE_LIMITER = get_rate_limiter(
    name="openai_embeddings",
    max_calls=_get_requests_per_second(),
    period=1.0,
)


def get_openai_embedding(text: str) -> Optional[List[float]]:
    if not text or not OPENAI_API_KEY:
        return None
    if len(text) > 12000:
        text = text[:12000]
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"model": OPENAI_EMBED_MODEL, "input": text}
    try:
        _OPENAI_EMBED_RATE_LIMITER.acquire()
        resp = requests.post(OPENAI_EMBED_URL, headers=headers, json=payload, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('data') and data['data'][0].get('embedding'):
                return data['data'][0]['embedding']
    except Exception:
        pass
    return None

