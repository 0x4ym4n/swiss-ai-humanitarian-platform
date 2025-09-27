import json
import os
import time
import random
import requests

from .rate_limiter import get_rate_limiter

MAX_RETRIES = 2


def _get_requests_per_second(default: int = 5) -> int:
    try:
        value = int(os.environ.get("HUGGINGFACE_REQUESTS_PER_SECOND", default))
        if value > 0:
            return value
    except Exception:
        pass
    return default


_HUGGINGFACE_RATE_LIMITER = get_rate_limiter(
    name="huggingface",
    max_calls=_get_requests_per_second(),
    period=2.0,
)


def call_huggingface(content, model="swiss-ai/Apertus-70B-Instruct-2509:publicai", retry_count=0, stream=False):
    data = {
        "messages": [
            {"role": "user", "content": content}
        ],
        "model": model,
        "stream": stream,
    }

    headers = {
        "Authorization": f"Bearer {os.environ.get('HF_TOKEN', '')}",
        "Content-Type": "application/json",
    }

    prompt_char_len = len(content or "")
    # Rough token estimate if API usage is missing (approx 4 chars/token)
    est_prompt_tokens = max(1, prompt_char_len // 4)

    try:
        _HUGGINGFACE_RATE_LIMITER.acquire()
        print(f"Requesting HuggingFace model={model} attempt={retry_count + 1}/{MAX_RETRIES + 1} prompt_len_chars={prompt_char_len} (~{est_prompt_tokens} toks) stream={stream}")
        t0 = time.time()
        response = requests.post('https://router.huggingface.co/v1/chat/completions', headers=headers, json=data, timeout=120, stream=stream)
        elapsed_ms = int((time.time() - t0) * 1000)

        if response.status_code == 200:
            if stream:
                return _handle_streaming_response(response, model, est_prompt_tokens, elapsed_ms)
            else:
                body = response.json()
                usage = body.get('usage') or {}
                prompt_tokens = usage.get('prompt_tokens') or est_prompt_tokens
                completion_tokens = usage.get('completion_tokens') or 0
                total_tokens = usage.get('total_tokens') or (prompt_tokens + completion_tokens)
                print(f"HuggingFace OK model={model} prompt_tokens={prompt_tokens} completion_tokens={completion_tokens} total_tokens={total_tokens} time_ms={elapsed_ms}")
                return body['choices'][0]['message']['content']
        else:
            try:
                err_body = response.json()
            except Exception:
                err_body = {"text": response.text[:500]}
            print(f"HuggingFace ERROR status={response.status_code} time_ms={elapsed_ms} body={json.dumps(err_body)[:500]}")
    except Exception as e:
        print(f"Exception in HuggingFace call: {str(e)}")

    if retry_count < MAX_RETRIES:
        # exponential backoff with jitter - increased delays for rate limiting
        delay = (3 ** retry_count) + random.uniform(1, 3)
        time.sleep(delay)
        return call_huggingface(content, model, retry_count + 1, stream)
    raise RuntimeError("Max retries reached for HuggingFace")


def _handle_streaming_response(response, model, est_prompt_tokens, elapsed_ms):
    """Handle streaming response from HuggingFace API"""
    content_parts = []

    try:
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data_str = line[6:]  # Remove 'data: ' prefix
                    if data_str.strip() == '[DONE]':
                        break
                    try:
                        data = json.loads(data_str)
                        if 'choices' in data and len(data['choices']) > 0:
                            delta = data['choices'][0].get('delta', {})
                            if 'content' in delta:
                                content_parts.append(delta['content'])
                    except json.JSONDecodeError:
                        continue

        full_content = ''.join(content_parts)
        completion_tokens = len(full_content) // 4  # Rough estimate
        total_tokens = est_prompt_tokens + completion_tokens

        print(f"HuggingFace Stream OK model={model} prompt_tokens={est_prompt_tokens} completion_tokens={completion_tokens} total_tokens={total_tokens} time_ms={elapsed_ms}")
        return full_content

    except Exception as e:
        print(f"Error handling streaming response: {str(e)}")
        return ''.join(content_parts) if content_parts else ""


def call_huggingface_streaming(content, model="swiss-ai/Apertus-70B-Instruct-2509:publicai"):
    """Generator function for streaming responses"""
    data = {
        "messages": [
            {"role": "user", "content": content}
        ],
        "model": model,
        "stream": True,
    }

    headers = {
        "Authorization": f"Bearer {os.environ.get('HF_TOKEN', '')}",
        "Content-Type": "application/json",
    }

    try:
        _HUGGINGFACE_RATE_LIMITER.acquire()
        response = requests.post('https://router.huggingface.co/v1/chat/completions', headers=headers, json=data, timeout=120, stream=True)

        if response.status_code == 200:
            for line in response.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        data_str = line[6:]  # Remove 'data: ' prefix
                        if data_str.strip() == '[DONE]':
                            break
                        try:
                            data = json.loads(data_str)
                            if 'choices' in data and len(data['choices']) > 0:
                                delta = data['choices'][0].get('delta', {})
                                if 'content' in delta:
                                    yield delta['content']
                        except json.JSONDecodeError:
                            continue
        else:
            raise RuntimeError(f"HuggingFace API error: {response.status_code}")

    except Exception as e:
        print(f"Exception in HuggingFace streaming call: {str(e)}")
        raise