import os
import json
import requests
from typing import Optional

MISTRAL_API_KEY = os.environ.get('MISTRAL_API_KEY', '')


def extract_text_with_mistral_ocr(pdf_url: str) -> Optional[str]:
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {MISTRAL_API_KEY}'
    }
    payload = {
        "model": "mistral-ocr-latest",
        "document": {"type": "document_url", "document_url": pdf_url},
        "include_image_base64": False
    }
    try:
        resp = requests.post("https://api.mistral.ai/v1/ocr", headers=headers, data=json.dumps(payload), timeout=60)
        if resp.status_code == 200:
            result = resp.json()
            text_content = []
            for page in result.get('pages', []):
                if 'markdown' in page:
                    text_content.append(page['markdown'])
            return "\n".join(text_content)
        return None
    except Exception:
        return None


