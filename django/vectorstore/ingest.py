import os
import json
import hashlib
from typing import Any, Dict, List, Optional, Tuple, Set
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from django.conf import settings
from .models import Document

# External LLM utilities from reference (user-provided sample paths)
# We treat them as black boxes providing the requested functionality
from .llm.huggingface import call_huggingface
from .llm.qwen_embeddings import get_qwen_embeddings
from .llm.openai_embeddings import get_openai_embedding
from .llm.visual import extract_text_with_mistral_ocr
from .llm.openai_chat import call_openai2


COLLECTION = 'projects'

# Canonical Sudan states (with basic variants)
SUDAN_STATES: Dict[str, List[str]] = {
    "kassala": ["kassala", "kassala state"],
    "gedaref": ["gedaref", "gadarif", "al qadarif", "gedarif"],
    "red sea": ["red sea", "red sea state", "port sudan"],
    "north kordofan": ["north kordofan", "north kordufan"],
    "south kordofan": ["south kordofan", "south kordufan"],
    "west kordofan": ["west kordofan", "west kordufan"],
    "blue nile": ["blue nile"],
    "white nile": ["white nile"],
    "sennar": ["sennar"],
    "khartoum": ["khartoum"],
    "river nile": ["river nile"],
    "northern": ["northern"],
    "east darfur": ["east darfur"],
    "north darfur": ["north darfur"],
    "south darfur": ["south darfur"],
    "central darfur": ["central darfur"],
    "west darfur": ["west darfur"],
}

# Simple theme lexicon for rule-based tagging (extend as needed)
THEME_LEXICON: Dict[str, List[str]] = {
    "wash": [
        "wash", "watsan", "water", "sanitation", "hygiene", "latrine",
        "borehole", "chlorination", "handwashing", "water resources",
        "water supply", "solar pump", "water point"
    ],
    "food_security": ["food", "agricultur", "seed", "harvest", "livestock"],
    "livelihoods": ["livelihood", "income", "business", "cash-for-work", "micro-grant"],
    "energy": ["solar", "energy", "electric", "streetlight"],
    "health": ["health", "clinic", "vaccin", "medical"],
}


def get_qdrant() -> QdrantClient:
    return QdrantClient(url=os.environ.get('QDRANT_URL', 'http://localhost:6333'))


def ensure_collection(vector_size: Optional[int] = None) -> None:
    client = get_qdrant()
    try:
        client.get_collection(COLLECTION)
    except Exception:
        # Default to 1536 to match text-embedding-3-small unless overridden
        size = vector_size or int(getattr(settings, 'EMBEDDING_DIMENSIONS', 1536))
        client.recreate_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=size, distance=Distance.COSINE),
        )


def llm_structurize_project(raw_text: str, lang_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Use OpenRouter LLM to map arbitrary unstructured project text into a structured schema.
    The schema includes commonly needed fields for humanitarian projects.
    """
    system_prompt = (
        "You are a data normalizer for humanitarian project metadata. "
        "Extract a JSON object with fields: title, summary, objectives, target_groups, outcomes, results, "
        "country_region, period, budget, sector, sub_sector, aid_type, partners, directorate, project_number, "
        "sources (array of URLs), language, key_terms (array), and any dates you can detect. "
        "Keep text concise and normalized; if unknown, use empty string."
    )
    content = f"{system_prompt}\n\nLANG={lang_hint or 'unknown'}\n\nTEXT:\n{raw_text}"
    try:
        response_text = call_huggingface(content, stream=False)
        data = json.loads(response_text) if isinstance(response_text, str) else {}
        if not isinstance(data, dict):
            return {"title": "", "summary": raw_text[:500]}
        return data
    except Exception:
        return {"title": "", "summary": raw_text[:500]}


def fetch_and_ocr_attachments(attachments: List[Dict[str, str]]) -> str:
    """
    For each attachment with a URL, run Mistral OCR to extract text. Concatenate.
    Then pass a brief visual reasoning step via OpenAI to summarize any tables/visuals if applicable.
    """
    ocr_chunks: List[str] = []
    for att in attachments:
        url = att.get('url') or att.get('href')
        if not url:
            continue
        text = extract_text_with_mistral_ocr(url)
        if text:
            ocr_chunks.append(text)
    if not ocr_chunks:
        return ""
    ocr_text = "\n\n".join(ocr_chunks)
    try:
        visual_summary = call_huggingface(
            "Summarize key facts from OCR content; include numbers, dates, and entities.\n\n" + ocr_text[:12000],
            stream=False
        )
        return (visual_summary or "") + "\n\n" + ocr_text
    except Exception:
        return ocr_text


def build_embedding(text: str) -> Optional[List[float]]:
    target_size = int(getattr(settings, 'EMBEDDING_DIMENSIONS', 1536))

    # Prefer OpenAI embeddings (1536 for text-embedding-3-small)
    emb = get_openai_embedding(text)
    if emb and len(emb) == target_size:
        return emb

    # Fallback to Qwen only if it exactly matches target size
    emb = get_qwen_embeddings(text)
    if emb and len(emb) == target_size:
        return emb

    return None


def parse_limit(query: str, default_limit: int) -> int:
    q = (query or '').lower()
    # Simple patterns: "first 12", "top 12", "show 12"
    import re
    m = re.search(r"\b(first|top|show|list)\s+(\d{1,3})\b", q)
    if m:
        try:
            n = int(m.group(2))
            if 1 <= n <= 100:
                return n
        except Exception:
            pass
    return default_limit


def build_query_plan(query: str, default_limit: int = 15) -> Dict[str, Any]:
    """Generic, neutral query planner. Extracts soft filters and requested fields while avoiding hardcoded biases."""
    q = (query or '').lower()
    # Detect source preference
    prefer_source = None
    if any(k in q for k in ["sdc", "swiss", "eda"]):
        prefer_source = "SDC"
    elif "reliefweb" in q:
        prefer_source = "ReliefWeb"

    # Detect locations (Sudan states) and country-level term
    loc_hits: List[str] = []
    for canon, variants in SUDAN_STATES.items():
        if any(v in q for v in variants):
            loc_hits.append(canon.title())
    prefers_country = "sudan" if "sudan" in q else None

    # Detect themes
    theme_hits: List[str] = []
    for theme, terms in THEME_LEXICON.items():
        if any(t in q for t in terms):
            theme_hits.append(theme)

    # Detect requested fields (for projection hints only when explicitly requested)
    requested_fields: List[str] = []
    field_map = {
        'eda project id': 'project_number',
        'project id': 'project_number',
        'eda id': 'project_number',
        'id': 'project_number',
        'title': 'title',
        'start': 'start_date',
        'end': 'end_date',
        'start date': 'start_date',
        'end date': 'end_date',
        'dates': 'period',
        'budget': 'budget',
        'budgets': 'budget',
        'partner': 'partners',
        'partners': 'partners',
        'url': 'url',
        'source': 'source',
        'sector': 'sector',
        'objective': 'objectives',
        'objectives': 'objectives',
        'timeframe': 'period',
        'timeframes': 'period',
    }
    for key, field in field_map.items():
        if key in q:
            if field not in requested_fields:
                requested_fields.append(field)

    # If timeframe(s) requested, also include explicit start/end
    if any(k in q for k in ['timeframe', 'timeframes']):
        for extra in ['start_date', 'end_date']:
            if extra not in requested_fields:
                requested_fields.append(extra)

    # Extract top limit if requested
    limit = parse_limit(query, default_limit=default_limit)

    # Capture organization tokens (for soft re-ranking)
    org_terms = []
    for token in ["unicef", "undp", "ocha", "wfp", "who", "unhcr", "mercy corps", "islamic relief", "ifrc", "icrc"]:
        if token in q:
            org_terms.append(token)

    # Output format preference
    wants_json = ("json" in q) or ("json format" in q) or ("in a json" in q)

    # Region budget aggregation intent
    region_budget_query = ("region" in q or "regions" in q or "state" in q or "states" in q) and ("budget" in q or "budgets" in q)
    # Aggregation policy hints
    agg_exclusive = any(t in q for t in ["exclusive", "exclusively", "only projects that exclusively cover"])
    agg_inclusive = any(t in q for t in ["inclusive", "combined", "not disaggregated", "count each project for all regions it covers"])
    agg_proportional = any(t in q for t in ["proportional", "split", "equal split", "share equally"]) 

    # Extract explicit EDA project IDs in the query (e.g., 7F11550)
    import re
    project_ids = re.findall(r"\b7F\d{5}\b", query or "")

    return {
        'prefer_source': prefer_source,
        'locations': loc_hits,
        'country': prefers_country,
        'themes': theme_hits,
        'requested_fields': requested_fields,
        'limit': limit,
        'org_terms': org_terms,
        'project_ids': project_ids,
        'wants_json': wants_json,
        'region_budget_query': region_budget_query,
        'agg_exclusive': agg_exclusive,
        'agg_inclusive': agg_inclusive,
        'agg_proportional': agg_proportional,
    }


def extract_locations(text: str) -> List[str]:
    """Detect Sudan state mentions in free text and return canonicalized list."""
    if not text:
        return []
    t = (text or "").lower()
    found: Set[str] = set()
    for canon, variants in SUDAN_STATES.items():
        for v in variants:
            if v in t:
                found.add(canon)
                break
    return [s.title() for s in sorted(found)]


def extract_themes(text: str) -> List[str]:
    """Rule-based theme tagging, focused on WASH coverage."""
    if not text:
        return []
    t = (text or "").lower()
    themes: List[str] = []
    for theme, terms in THEME_LEXICON.items():
        for term in terms:
            if term in t:
                themes.append(theme)
                break
    return sorted(list(set(themes)))


def upsert_project_point(
    point_id: int,
    vector: List[float],
    payload: Dict[str, Any],
) -> None:
    client = get_qdrant()
    client.upsert(
        collection_name=COLLECTION,
        wait=True,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)],
    )


def ingest_unstructured_project(
    source: str,
    title: str,
    raw_text: str,
    attachments: Optional[List[Dict[str, str]]] = None,
    lang_hint: Optional[str] = None,
    origin_url: Optional[str] = None,
    external_id: Optional[str] = None,
    structured_overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Full pipeline: structure -> enrich OCR -> embed -> store RDB + Qdrant."""
    ensure_collection()

    # LLM-based structuring
    structured = llm_structurize_project(raw_text, lang_hint=lang_hint)
    # Merge structured overrides (e.g., from trusted JSON fields)
    if structured_overrides:
        # Normalize common override keys to our schema
        overrides = dict(structured_overrides)
        if 'project_partners' in overrides and 'partners' not in overrides:
            overrides['partners'] = overrides.get('project_partners')
        if 'swiss_budget' in overrides and 'budget' not in overrides:
            overrides['budget'] = overrides.get('swiss_budget')
        # Prefer explicit start/end if present
        for k in ['title', 'summary', 'objectives', 'results', 'outcomes', 'target_groups',
                  'country_region', 'period', 'budget', 'sector', 'sub_sector', 'aid_type',
                  'partners', 'directorate', 'project_number', 'start_date', 'end_date',
                  'budget_details']:
            if overrides.get(k):
                structured[k] = overrides[k]

    # OCR / visual reasoning
    extra_text = fetch_and_ocr_attachments(attachments or [])

    # Compose index text
    index_text = "\n\n".join([
        structured.get('title', title),
        structured.get('summary', ''),
        structured.get('objectives', ''),
        structured.get('results', ''),
        structured.get('outcomes', ''),
        structured.get('target_groups', ''),
        extra_text,
        raw_text,
    ])

    # Store in relational for lineage
    doc = Document.objects.create(
        source=source,
        external_id=external_id or structured.get('project_number', ''),
        title=structured.get('title', title) or title,
        content=index_text,
    )

    # Derived fields for better retrieval
    locations = extract_locations(index_text)
    themes = extract_themes(index_text)

    # Build embedding and upsert to Qdrant
    vector = build_embedding(index_text)
    if not vector:
        # Skip upsert if embedding failed or mismatched size
        return {'doc_id': doc.id, 'point_id': None, 'structured': structured, 'warning': 'embedding_unavailable_or_mismatch'}
    # Deterministic point id from source + external_id + url
    id_key = f"{source}|{external_id or structured.get('project_number','')}|{origin_url or ''}"
    h = hashlib.blake2b(id_key.encode('utf-8'), digest_size=8).digest()
    point_id = int.from_bytes(h, byteorder='big', signed=False)
    payload = {
        'source': source,
        'title': structured.get('title', title) or title,
        'structured': structured,
        'lang': lang_hint or '',
        'url': origin_url or '',
        'external_id': external_id or structured.get('project_number', ''),
        # Flatten key fields for filtering
        'project_number': structured.get('project_number', ''),
        'country_region': structured.get('country_region', ''),
        'period': structured.get('period', ''),
        'budget': structured.get('budget', '') or structured.get('budget_details', ''),
        'sector': structured.get('sector', ''),
        # Derived
        'locations': locations,
        'themes': themes,
        'content_preview': index_text[:1200],
    }
    upsert_project_point(point_id, vector, payload)
    return {'doc_id': doc.id, 'point_id': point_id, 'structured': structured}


def query_rag(query: str, top_k: int = 15, strict: bool = False) -> Dict[str, Any]:
    """Semantic search + compact synthesis with citations."""
    client = get_qdrant()
    emb = build_embedding(query)
    # Build a neutral plan from query
    plan = build_query_plan(query, default_limit=top_k)
    q_lc = (query or '').lower()

    from qdrant_client.models import Filter, FieldCondition, MatchValue
    should_conditions = []
    must_conditions = []
    if plan['prefer_source']:
        (must_conditions if strict else should_conditions).append(FieldCondition(key='source', match=MatchValue(value=plan['prefer_source'])))
    for loc in plan['locations']:
        (must_conditions if strict else should_conditions).append(FieldCondition(key='locations', match=MatchValue(value=loc)))
    for theme in plan['themes']:
        (must_conditions if strict else should_conditions).append(FieldCondition(key='themes', match=MatchValue(value=theme)))
    if plan['country']:
        (must_conditions if strict else should_conditions).append(FieldCondition(key='country_region', match=MatchValue(value='Sudan')))
    for pid in plan.get('project_ids', []) or []:
        (must_conditions if strict else should_conditions).append(FieldCondition(key='project_number', match=MatchValue(value=pid)))

    q_filter = None
    if should_conditions or must_conditions:
        q_filter = Filter(should=should_conditions, must=must_conditions)

    # Increase recall for regional budget aggregation questions
    effective_limit = max(plan['limit'], 80) if plan.get('region_budget_query') else max(plan['limit'], max(top_k, 30))

    search = client.query_points(
        collection_name=COLLECTION,
        query=emb,
        with_payload=True,
        limit=effective_limit,
        query_filter=q_filter,
    ).points
    # Fallback without filter if nothing matched
    if not search:
        search = client.query_points(
            collection_name=COLLECTION,
            query=emb,
            with_payload=True,
            limit=max(top_k, 30),
        ).points

    # Lightweight keyword-aware re-ranking
    contexts: List[str] = []
    citations: List[Tuple[int, str, str, str, str]] = []  # (id, title, url, source, external_id)

    query_lc = q_lc
    keywords = {w for w in query_lc.replace(',', ' ').split() if len(w) >= 3}
    # Dynamically prefer tokens extracted from the plan
    preferred_dynamic: Set[str] = set([t.lower() for t in plan['locations']])
    preferred_dynamic |= set([t.lower() for t in plan['themes']])
    preferred_dynamic |= set([t.lower() for t in plan['org_terms']])
    if plan['prefer_source']:
        preferred_dynamic.add(str(plan['prefer_source']).lower())
    for pid in plan.get('project_ids', []) or []:
        preferred_dynamic.add(pid.lower())

    def calc_boost(payload: Dict[str, Any]) -> float:
        blob = ' '.join([
            str(payload.get('title', '')),
            json.dumps(payload.get('structured', {}), ensure_ascii=False),
            str(payload.get('source', '')),
            str(payload.get('url', '')),
            str(payload.get('sector', '')),
            str(payload.get('country_region', '')),
            ' '.join(payload.get('locations', []) or []),
            ' '.join(payload.get('themes', []) or []),
            str(payload.get('content_preview', '')),
        ]).lower()
        b = 0.0
        for k in keywords:
            if k in blob:
                b += 0.2
        for k in preferred_dynamic:
            if k in blob:
                b += 0.3
        return b

    ranked: List[Tuple[float, Any]] = []
    for p in search:
        payload = p.payload or {}
        base_score = float(getattr(p, 'score', 0.0) or 0.0)
        ranked.append((base_score + calc_boost(payload), p))
    ranked.sort(key=lambda t: t[0], reverse=True)

    def matches_query(payload: Dict[str, Any]) -> bool:
        if not payload:
            return False
        ok = True
        if plan['locations']:
            locs = set([str(x).lower() for x in (payload.get('locations') or [])])
            if not any(l.lower() in locs for l in plan['locations']):
                ok = False
        if plan['themes']:
            th = set([str(x).lower() for x in (payload.get('themes') or [])])
            if not any(t.lower() in th for t in plan['themes']):
                ok = False
        if plan['prefer_source']:
            if str(payload.get('source', '')).lower() != plan['prefer_source'].lower():
                ok = False
        if plan['country']:
            if 'sudan' not in str(payload.get('country_region', '')).lower():
                ok = False
        return ok

    shortlisted: List[Tuple[Any, Dict[str, Any], str]] = []
    for _, p in ranked:
        payload = p.payload or {}
        structured = payload.get('structured', {})
        title = payload.get('title', '')
        url = payload.get('url', '')
        source = payload.get('source', '')
        external_id = payload.get('external_id', '')
        ctx = json.dumps({
            'title': title,
            'objectives': structured.get('objectives', ''),
            'results': structured.get('results', ''),
            'country_region': structured.get('country_region', ''),
            'period': structured.get('period', ''),
            'budget': structured.get('budget', ''),
            'budget_details': structured.get('budget_details', ''),
            'sector': structured.get('sector', ''),
            'sub_sector': structured.get('sub_sector', ''),
            'aid_type': structured.get('aid_type', ''),
            'partners': structured.get('partners', ''),
            'project_number': structured.get('project_number', ''),
            'start_date': structured.get('start_date', ''),
            'end_date': structured.get('end_date', ''),
            'locations': payload.get('locations', []),
            'themes': payload.get('themes', []),
            'source': source,
            'url': url,
        }, ensure_ascii=False)
        shortlisted.append((p, payload, ctx))

    filtered = [(p, payload, ctx) for (p, payload, ctx) in shortlisted if matches_query(payload)]
    chosen = filtered if filtered else shortlisted

    selected = chosen[:plan['limit']]
    for p, payload, ctx in selected:
        contexts.append(ctx)
        citations.append((p.id, payload.get('title', ''), payload.get('url', ''), payload.get('source', ''), payload.get('external_id', '')))  # type: ignore
    # Always defer final formatting to the model to keep outputs as requested by the user
    prompt_blocks = [
        # Project context and principles
        "You are the Humanitarian Knowledge Assistant for the Swiss Federal Department of Foreign Affairs (FDFA).",
        "Use ONLY facts present in the provided CONTEXTS. Do not invent data.",
        "Be transparent: the system will attach citations separately; do not write them in the answer.",
        "Adapt detail to the user's question (operational vs strategic).",
        "Language: respond in the language of the user's question (English, French, or Arabic). If unclear, use English.",
        # Formatting guardrails
        "Answer ONLY the current QUESTION below.",
        "Follow the user's requested format exactly; do not add extra headings, labels, or sections.",
        "If the user names specific fields (e.g., budget, partners, project IDs, dates), include only those fields.",
        "If a budget covers multiple locations, note when it is not disaggregated.",
        "If charts are requested, provide compact JSON data structures (labels, series).",
    ]

    # Region budget guidance (prompt-level awareness)
    if plan.get('region_budget_query'):
        # Clarify aggregation policy based on user wording
        if plan.get('agg_exclusive'):
            prompt_blocks.append(
                "Aggregation policy: EXCLUSIVE — only count budgets of projects that mention exactly one region; "
                "exclude budgets of multi-region projects to avoid double counting."
            )
        elif plan.get('agg_proportional'):
            prompt_blocks.append(
                "Aggregation policy: PROPORTIONAL — for multi-region projects, split the total budget equally across the regions mentioned (simple equal share)."
            )
        elif plan.get('agg_inclusive'):
            prompt_blocks.append(
                "Aggregation policy: INCLUSIVE — count the full budget for each region mentioned; "
                "explicitly label totals as 'not disaggregated' to avoid misinterpretation."
            )
        else:
            prompt_blocks.append(
                "Aggregation policy: If not specified by the user, present INCLUSIVE totals (count full project budget in each region mentioned) "
                "and clearly mark them as 'not disaggregated'. Avoid inventing disaggregations."
            )
        prompt_blocks.append(
            "When summarizing per-region totals, list the region, the computed total, and a short note if totals include budgets from multi-region projects (not disaggregated)."
        )

    # JSON-only answer if requested
    if plan.get('wants_json'):
        prompt_blocks.append("Return valid JSON only with no trailing commentary.")
    # Pass requested fields only when explicitly detected
    if plan['requested_fields']:
        prompt_blocks.append("Requested fields: " + ", ".join(plan['requested_fields']))
    prompt = (
        "\n".join(prompt_blocks)
        + f"\n\nCONTEXTS:\n{chr(10).join(contexts)}\n\nQUESTION:\n{query}\n"
    )
    # Query LLM with robust fallbacks
    model = os.environ.get('OPENROUTER_MODEL', 'openai/gpt-4o-mini')
    answer: Optional[str] = None
    try:
        answer = call_huggingface(prompt, stream=False)
    except Exception:
        try:
            answer = call_openai2(prompt)
        except Exception:
            answer = None

    if not answer:
        answer = "\n".join([f"- {t}" for _, t in citations]) or "No results"

    return {
        'answer': answer,
        'citations': [{'doc_id': str(d), 'title': t, 'url': u, 'source': s, 'external_id': x} for d, t, u, s, x in citations]
    }
