import json
import os
import time
import random
import requests

from .rate_limiter import get_rate_limiter

MAX_RETRIES = 2


def _get_requests_per_second(default: int = 20) -> int:
    try:
        value = int(os.environ.get("OPENROUTER_REQUESTS_PER_SECOND", default))
        if value > 0:
            return value
    except Exception:
        pass
    return default


_OPENROUTER_RATE_LIMITER = get_rate_limiter(
    name="openrouter",
    max_calls=_get_requests_per_second(),
    period=1.0,
)



def call_open_router(content, model="openai/gpt-oss-120b", retry_count=0):
    data = {
        "messages": [
            {"role": "user", "content": content}
        ],
        "model": model,
    }

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    prompt_char_len = len(content or "")
    # Rough token estimate if API usage is missing (approx 4 chars/token)
    est_prompt_tokens = max(1, prompt_char_len // 4)

    try:
        _OPENROUTER_RATE_LIMITER.acquire()
        print(f"Requesting OpenRouter model={model} attempt={retry_count + 1}/{MAX_RETRIES + 1} prompt_len_chars={prompt_char_len} (~{est_prompt_tokens} toks)")
        t0 = time.time()
        response = requests.post('https://openrouter.ai/api/v1/chat/completions', headers=headers, data=json.dumps(data), timeout=120)
        elapsed_ms = int((time.time() - t0) * 1000)

        if response.status_code == 200:
            body = response.json()
            usage = body.get('usage') or {}
            prompt_tokens = usage.get('prompt_tokens') or est_prompt_tokens
            completion_tokens = usage.get('completion_tokens') or 0
            total_tokens = usage.get('total_tokens') or (prompt_tokens + completion_tokens)
            print(f"OpenRouter OK model={model} prompt_tokens={prompt_tokens} completion_tokens={completion_tokens} total_tokens={total_tokens} time_ms={elapsed_ms}")
            return body['choices'][0]['message']['content']
        else:
            try:
                err_body = response.json()
            except Exception:
                err_body = {"text": response.text[:500]}
            print(f"OpenRouter ERROR status={response.status_code} time_ms={elapsed_ms} body={json.dumps(err_body)[:500]}")
    except Exception as e:
        print(f"Exception in open router call: {str(e)}")

    if retry_count < MAX_RETRIES:
        # exponential backoff with jitter
        delay = (2 ** retry_count) + random.random()
        time.sleep(delay)
        return call_open_router(content, model, retry_count + 1)
    raise RuntimeError("Max retries reached for OpenRouter")
