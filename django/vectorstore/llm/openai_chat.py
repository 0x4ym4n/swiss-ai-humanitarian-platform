import json
import os
import requests
from typing import Optional


def call_openai2(content: str, model: str = "gpt-4o-mini") -> Optional[str]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    data = {
        "messages": [{"role": "user", "content": content}],
        "model": model,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    resp = requests.post('https://api.openai.com/v1/chat/completions', headers=headers, data=json.dumps(data), timeout=60)
    if resp.status_code == 200:
        return resp.json()['choices'][0]['message']['content']
    return None


