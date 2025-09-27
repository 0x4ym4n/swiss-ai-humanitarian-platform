import os
from rest_framework.decorators import api_view
from rest_framework.response import Response
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from django.views.decorators.csrf import csrf_exempt
from django.middleware.csrf import get_token
from .ingest import ingest_unstructured_project, query_rag, build_query_plan, SUDAN_STATES
from django.db import models
import json
import re
from collections import defaultdict
from django.http import FileResponse, HttpResponse, Http404


# --- Helpers to read source datasets ---
_SWISS_CACHE = None


def _load_swiss():
    global _SWISS_CACHE
    if _SWISS_CACHE is not None:
        return _SWISS_CACHE
    path = os.environ.get('SWISS_PATH', os.path.abspath(os.path.join(os.getcwd(), 'data_sources/swiss-gov-suudan-projects.json')))
    try:
        with open(path, 'r', encoding='utf-8') as f:
            _SWISS_CACHE = json.load(f)
    except Exception:
        _SWISS_CACHE = []
    return _SWISS_CACHE


def _parse_chf(s: str) -> int:
    if not s:
        return 0
    m = re.search(r'CHF\s*[\d’\'\s,\.]+', s)
    s2 = m.group(0) if m else s
    n = ''.join(re.findall(r'[\d’\']+', s2)).replace('’', '').replace("'", '').replace(',', '')
    try:
        return int(n)
    except Exception:
        return 0


def _extract_regions(text: str) -> list:
    t = (text or '').lower()
    found = set()
    for canon, variants in SUDAN_STATES.items():
        for v in variants:
            if v in t:
                found.add(canon.title())
                break
    return sorted(found)


def _swiss_iter():
    for item in _load_swiss():
        details = item.get('details', {})
        text_parts = [item.get('title', ''), item.get('desc', ''), details.get('background', ''), details.get('objectives', ''), details.get('outcomes', ''), details.get('results', ''), details.get('coordination', '')]
        text = '\n'.join([t for t in text_parts if t])
        budget = details.get('swiss_budget') or details.get('budget') or ''
        yield {
            'title': item.get('title', ''),
            'project_number': details.get('project_number', ''),
            'partners': details.get('project_partners', ''),
            'period': details.get('period', '') or (item.get('time') or ''),
            'start_date': details.get('start_date', ''),
            'end_date': details.get('end_date', ''),
            'sector': details.get('sector', ''),
            'budget': budget,
            'budget_int': _parse_chf(budget),
            'regions': _extract_regions(text),
        }


def get_qdrant():
    url = os.environ.get('QDRANT_URL', 'http://localhost:6333')
    return QdrantClient(url=url)


@api_view(['GET'])
def health(_request):
    return Response({'status': 'ok'})


@csrf_exempt
@api_view(['POST'])
def qdrant_init(_request):
    client = get_qdrant()
    client.recreate_collection(
        collection_name='test_collection',
        vectors_config=VectorParams(size=4, distance=Distance.DOT),
    )
    return Response({'created': True})


@csrf_exempt
@api_view(['POST'])
def qdrant_upsert_sample(_request):
    client = get_qdrant()
    operation_info = client.upsert(
        collection_name='test_collection',
        wait=True,
        points=[
            PointStruct(id=1, vector=[0.05, 0.61, 0.76, 0.74], payload={'city': 'Berlin'}),
            PointStruct(id=2, vector=[0.19, 0.81, 0.75, 0.11], payload={'city': 'London'}),
            PointStruct(id=3, vector=[0.36, 0.55, 0.47, 0.94], payload={'city': 'Moscow'}),
            PointStruct(id=4, vector=[0.18, 0.01, 0.85, 0.80], payload={'city': 'New York'}),
            PointStruct(id=5, vector=[0.24, 0.18, 0.22, 0.44], payload={'city': 'Beijing'}),
            PointStruct(id=6, vector=[0.35, 0.08, 0.11, 0.44], payload={'city': 'Mumbai'}),
        ],
    )
    return Response({'operation': str(operation_info)})


@api_view(['GET'])
def qdrant_query_sample(_request):
    client = get_qdrant()
    res = client.query_points(
        collection_name='test_collection',
        query=[0.2, 0.1, 0.9, 0.7],
        query_filter=Filter(must=[FieldCondition(key='city', match=MatchValue(value='London'))]),
        with_payload=True,
        limit=3,
    ).points
    return Response({'results': [p.dict() for p in res]})


@api_view(['GET'])
def csrf_token(request):
    return Response({'csrfToken': get_token(request)})


@csrf_exempt
@api_view(['POST'])
def ingest_endpoint(request):
    data = request.data if hasattr(request, 'data') else {}
    source = data.get('source', 'manual')
    title = data.get('title', '')
    text = data.get('text', '')
    attachments = data.get('attachments', [])
    lang = data.get('lang')
    res = ingest_unstructured_project(source, title, text, attachments, lang_hint=lang)
    return Response(res)


@api_view(['POST'])
def rag_query_endpoint(request):
    q = request.data.get('query', '')
    try:
        top_k = int(request.data.get('top_k', 15))
    except Exception:
        top_k = 15
    strict = bool(request.data.get('strict', False))
    res = query_rag(q or '', top_k=top_k, strict=strict)
    return Response(res)


# --- Metrics endpoints ---

@api_view(['GET'])
def metrics_overview(_request):
    items = list(_swiss_iter())
    total_projects = len(items)
    total_budget = sum(i['budget_int'] for i in items)
    wash_projects = [i for i in items if 'wash' in (i['sector'] or '').lower()]
    active = 0
    from datetime import datetime
    today = datetime.utcnow().date()
    for i in items:
        sd = i.get('start_date') or ''
        ed = i.get('end_date') or ''
        try:
            sdd = datetime.strptime(sd[:10], '%d.%m.%Y').date() if '.' in sd else datetime.strptime(sd[:10], '%d.%m.%Y').date()
        except Exception:
            sdd = None
        try:
            # Accept either dd.mm.yyyy or dd.mm.yyyy; dataset varies
            edd = datetime.strptime(ed[:10], '%d.%m.%Y').date() if '.' in ed else datetime.strptime(ed[:10], '%d.%m.%Y').date()
        except Exception:
            edd = None
        if sdd and edd and sdd <= today <= edd:
            active += 1
    return Response({
        'total_projects': total_projects,
        'wash_projects': len(wash_projects),
        'total_budget_chf': total_budget,
        'active_projects_estimate': active,
    })


@api_view(['GET'])
def metrics_partners(_request):
    # Aggregate by partner (string) total budget
    parts = defaultdict(int)
    for i in _swiss_iter():
        partners = (i['partners'] or '').strip() or 'Unknown'
        parts[partners] += i['budget_int']
    top = sorted(parts.items(), key=lambda x: -x[1])[:7]
    labels = [p[0][:8] + ('…' if len(p[0]) > 8 else '') for p in top]
    values = [b for _, b in top]
    return Response({'labels': labels, 'series': [{'name': 'Budget', 'values': values}]})


@api_view(['GET'])
def metrics_outcomes(_request):
    # Basic table of projects
    rows = []
    for i in _swiss_iter():
        rows.append({
            'title': i['title'],
            'partners': i['partners'],
            'budget': i['budget'],
            'period': i['period'],
            'project_number': i['project_number'],
        })
    return Response({'rows': rows[:20]})


@api_view(['GET'])
def metrics_region_budgets(request):
    policy = request.GET.get('policy', 'inclusive')
    inclusive = defaultdict(int)
    exclusive = defaultdict(int)
    for i in _swiss_iter():
        b = i['budget_int']
        if not b:
            continue
        regs = i['regions']
        if not regs:
            continue
        if len(regs) == 1:
            exclusive[regs[0]] += b
        for r in regs:
            inclusive[r] += b
    if policy == 'exclusive':
        data = [{'region': k, 'budget_chf': v, 'note': ''} for k, v in sorted(exclusive.items())]
    elif policy == 'proportional':
        prop = defaultdict(float)
        for i in _swiss_iter():
            b = i['budget_int']
            regs = i['regions']
            if b and regs:
                share = b / len(regs)
                for r in regs:
                    prop[r] += share
        data = [{'region': k, 'budget_chf': int(v), 'note': 'Proportional split across regions'} for k, v in sorted(prop.items())]
    else:
        data = [{'region': k, 'budget_chf': v, 'note': 'Includes multi-region budgets (not disaggregated)'} for k, v in sorted(inclusive.items())]
    return Response({'data': data})


@api_view(['POST'])
def prompt_analytics(request):
    payload = request.data or {}
    prompt = payload.get('prompt') or payload.get('query') or ''
    policy = payload.get('policy', '')  # inclusive|exclusive|proportional
    strict = bool(payload.get('strict', False))
    plan = build_query_plan(prompt)

    # Default response: RAG answer
    rag = query_rag(prompt, top_k=int(payload.get('top_k', 30)), strict=strict)
    result = {'mode': 'rag', 'answer': rag.get('answer', ''), 'citations': rag.get('citations', [])}

    # If the prompt is about region budgets, compute a chart + table
    if plan.get('region_budget_query'):
        if not policy:
            if plan.get('agg_exclusive'):
                policy = 'exclusive'
            elif plan.get('agg_proportional'):
                policy = 'proportional'
            else:
                policy = 'inclusive'
        # Create a mock request object with the policy parameter
        class MockRequest:
            def __init__(self, policy_value):
                self.GET = {'policy': policy_value}

        mock_req = MockRequest(policy)
        response = metrics_region_budgets(mock_req)
        data = response.data.get('data', [])
        labels = [d['region'] for d in data]
        values = [d['budget_chf'] for d in data]
        result.update({
            'mode': 'region_budgets',
            'chart': {'type': 'bar', 'labels': labels, 'series': [{'name': 'Budget (CHF)', 'values': values}]},
            'table': data,
            'policy': policy,
        })
    return Response(result)


@api_view(['GET'])
def sources_index(_request):
    files = []
    data_dir = _data_sources_dir()

    try:
        # List all files in the data_sources directory
        for filename in os.listdir(data_dir):
            filepath = os.path.join(data_dir, filename)
            # Only include files (not subdirectories)
            if os.path.isfile(filepath):
                info = _file_info(filename)
                if info:
                    files.append(info)

        # Sort files by name
        files.sort(key=lambda x: x['name'])
    except OSError:
        # Directory doesn't exist or can't be read
        pass

    return Response({'files': files})


@api_view(['GET'])
def download_source(_request, name: str):
    # Sanitize the filename to prevent directory traversal attacks
    filename = os.path.basename(name)

    # Check if filename is safe (no hidden files or special chars)
    if filename.startswith('.') or '/' in filename or '\\' in filename:
        raise Http404('Invalid filename')

    path = os.path.join(_data_sources_dir(), filename)

    # Ensure the file exists and is within the data_sources directory
    if not os.path.exists(path) or not os.path.isfile(path):
        raise Http404('File not found')

    # Get file extension to determine content type
    ext = os.path.splitext(filename)[1].lower()
    content_type_map = {
        '.json': 'application/json',
        '.js': 'application/javascript',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.geojson': 'application/geo+json',
    }
    content_type = content_type_map.get(ext, 'application/octet-stream')

    try:
        with open(path, 'rb') as f:
            resp = HttpResponse(f.read(), content_type=content_type)
            resp['Content-Disposition'] = f'attachment; filename="{filename}"'
            return resp
    except IOError:
        raise Http404('Cannot read file')
def _data_sources_dir():
    # In Docker, data_sources is mounted at /data_sources
    # In development, it's relative to current directory
    docker_path = '/data_sources'
    local_path = os.path.abspath(os.path.join(os.getcwd(), 'data_sources'))

    if os.path.exists(docker_path):
        return docker_path
    else:
        return local_path

def _file_info(name: str):
    p = os.path.join(_data_sources_dir(), name)
    if not os.path.exists(p):
        return None
    return {
        'name': name,
        'size_bytes': os.path.getsize(p),
        'url': f"/api/vectorstore/sources/download/{name}",
    }


@api_view(['POST'])
@csrf_exempt
def news_query_endpoint(request):
    """
    Query ReliefWeb news collection and structure data using LLM
    Expected payload: {
        "query": "search query",
        "collection": "reliefweb_news",
        "top_k": 12,
        "filter_category": "urgent" (optional)
    }
    """
    try:
        data = json.loads(request.body)
        query = data.get('query', 'Sudan humanitarian news')
        collection = data.get('collection', 'reliefweb_news')
        top_k = data.get('top_k', 12)
        filter_category = data.get('filter_category')

        # Connect to Qdrant (reuse existing get_qdrant function)
        client = get_qdrant()

        # Check if collection exists
        try:
            collections = client.get_collections()
            collection_names = [col.name for col in collections.collections]

            if collection not in collection_names:
                return Response({
                    'error': f'Collection "{collection}" not found. Available collections: {collection_names}',
                    'available_collections': collection_names
                }, status=404)
        except Exception as e:
            return Response({'error': f'Failed to connect to Qdrant: {str(e)}'}, status=500)

        # Query the news collection using scroll method
        try:
            # Use scroll to get points since search might not work with text query
            scroll_result = client.scroll(
                collection_name=collection,
                limit=top_k * 3,  # Get more to filter
                with_payload=True,
                with_vectors=False
            )

            points = scroll_result[0]  # First element is the list of points

            if not points:
                return Response({
                    'news': [],
                    'total': 0,
                    'query': query,
                    'collection': collection,
                    'message': 'No news items found in collection'
                })

        except Exception as e:
            return Response({'error': f'Failed to query collection: {str(e)}'}, status=500)

        # Structure the results
        structured_news = []
        query_lower = query.lower()

        for point in points:
            payload = point.payload

            # Enhanced relevance scoring
            title = payload.get('title', '')
            body = payload.get('body', payload.get('summary', ''))
            full_text = (title + ' ' + body).lower()

            # Calculate enhanced relevance score
            relevance = 0.0
            query_words = [word for word in query_lower.split() if len(word) > 2]  # Skip short words

            # Base relevance from query matching
            for word in query_words:
                # Title matches are more important
                if word in title.lower():
                    relevance += 0.4
                elif word in body.lower():
                    relevance += 0.2

            # Boost relevance for key humanitarian terms
            humanitarian_keywords = [
                'humanitarian', 'crisis', 'emergency', 'aid', 'relief', 'assistance',
                'conflict', 'disaster', 'famine', 'refugees', 'displaced', 'hunger',
                'malnutrition', 'cholera', 'outbreak', 'health', 'medical', 'food',
                'water', 'shelter', 'protection', 'violence', 'war'
            ]

            for keyword in humanitarian_keywords:
                if keyword in full_text:
                    relevance += 0.15

            # Boost for Sudan-specific terms
            sudan_keywords = [
                'sudan', 'sudanese', 'khartoum', 'darfur', 'kassala', 'blue nile',
                'white nile', 'gezira', 'sennar', 'gedaref', 'red sea'
            ]

            for keyword in sudan_keywords:
                if keyword in full_text:
                    relevance += 0.25

            # Enhanced time-based relevance scoring
            date_str = payload.get('date', payload.get('created_at', payload.get('published_date', '')))
            time_boost = 0.0

            if date_str:
                try:
                    from datetime import datetime, timedelta
                    import re

                    # Parse various date formats
                    parsed_date = None

                    # Try standard formats
                    for date_format in ['%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%SZ', '%d/%m/%Y', '%m/%d/%Y']:
                        try:
                            parsed_date = datetime.strptime(date_str[:10] if 'T' in date_str else date_str, date_format)
                            break
                        except:
                            continue

                    # Try parsing with regex for flexible formats
                    if not parsed_date:
                        date_match = re.search(r'(\d{4})-(\d{2})-(\d{2})', date_str)
                        if date_match:
                            year, month, day = date_match.groups()
                            parsed_date = datetime(int(year), int(month), int(day))

                    if parsed_date:
                        now = datetime.now()
                        days_old = (now - parsed_date).days

                        # Calculate time-based boost (more recent = higher boost)
                        if days_old <= 7:  # Within last week
                            time_boost = 0.3
                        elif days_old <= 30:  # Within last month
                            time_boost = 0.25
                        elif days_old <= 90:  # Within last 3 months
                            time_boost = 0.2
                        elif days_old <= 180:  # Within last 6 months
                            time_boost = 0.15
                        elif days_old <= 365:  # Within last year
                            time_boost = 0.1
                        elif days_old <= 730:  # Within last 2 years
                            time_boost = 0.05
                        else:  # Older than 2 years
                            time_boost = 0.0

                        # Additional boost for very recent breaking news
                        if days_old <= 1:  # Within last 24 hours
                            time_boost += 0.2
                        elif days_old <= 3:  # Within last 3 days
                            time_boost += 0.1

                    # Fallback: simple year-based scoring if parsing fails
                    else:
                        if '2025' in date_str:
                            time_boost = 0.2
                        elif '2024' in date_str:
                            time_boost = 0.15
                        elif '2023' in date_str:
                            time_boost = 0.1
                        elif '2022' in date_str:
                            time_boost = 0.05

                except Exception as e:
                    # Fallback to simple year check if date parsing fails
                    if '2025' in date_str:
                        time_boost = 0.2
                    elif '2024' in date_str:
                        time_boost = 0.15

            relevance += time_boost

            # Ensure minimum relevance for Sudan-related content
            if any(term in full_text for term in ['sudan', 'sudanese']):
                relevance = max(relevance, 0.3)

            # Cap relevance at 1.0
            relevance = min(relevance, 1.0)

            # Extract and structure the news item
            summary_text = body[:200] + '...' if len(body) > 200 else body

            news_item = {
                'id': str(point.id),
                'title': title or 'Untitled',
                'summary': summary_text or 'No summary available',
                'date': payload.get('date', payload.get('created_at', payload.get('published_date', ''))),
                'source': payload.get('source', 'ReliefWeb'),
                'url': payload.get('url', payload.get('link', '')),
                'relevance': min(relevance, 1.0),
                'category': _categorize_news(title + ' ' + body),
                'location': _extract_locations(title + ' ' + body),
                'urgency': _assess_urgency(title + ' ' + body)
            }

            # Apply filter if specified
            if filter_category == 'urgent' and news_item['urgency'] not in ['high', 'critical']:
                continue

            structured_news.append(news_item)

        # Sort by relevance and urgency
        structured_news.sort(key=lambda x: (
            1 if x['urgency'] == 'critical' else 0.8 if x['urgency'] == 'high' else 0.5,
            x['relevance']
        ), reverse=True)

        # Limit results
        structured_news = structured_news[:top_k]

        return Response({
            'news': structured_news,
            'total': len(structured_news),
            'query': query,
            'collection': collection
        })

    except json.JSONDecodeError:
        return Response({'error': 'Invalid JSON in request body'}, status=400)
    except Exception as e:
        return Response({'error': f'Unexpected error: {str(e)}'}, status=500)


def _categorize_news(text: str) -> str:
    """Categorize news based on content"""
    text_lower = text.lower()

    if any(word in text_lower for word in ['emergency', 'crisis', 'urgent', 'disaster', 'conflict']):
        return 'emergency'
    elif any(word in text_lower for word in ['humanitarian', 'aid', 'assistance', 'relief']):
        return 'humanitarian'
    elif any(word in text_lower for word in ['development', 'project', 'program', 'funding']):
        return 'development'
    elif any(word in text_lower for word in ['health', 'medical', 'healthcare', 'disease']):
        return 'health'
    else:
        return 'general'


def _extract_locations(text: str) -> list:
    """Extract location mentions from text"""
    locations = []
    text_lower = text.lower()

    # Check for Sudan states
    for state, variants in SUDAN_STATES.items():
        for variant in variants:
            if variant in text_lower:
                locations.append(state)
                break

    # Check for major cities and regions
    major_locations = ['sudan', 'khartoum', 'darfur', 'kassala', 'blue nile', 'south sudan']
    for location in major_locations:
        if location in text_lower and location not in [loc.lower() for loc in locations]:
            locations.append(location.title())

    return list(set(locations))


def _assess_urgency(text: str) -> str:
    """Assess urgency level based on content"""
    text_lower = text.lower()

    # Critical humanitarian situations
    critical_words = [
        'emergency', 'crisis', 'urgent', 'immediate', 'critical', 'disaster', 'catastrophe',
        'famine', 'starvation', 'genocide', 'massacre', 'war', 'conflict', 'bombing',
        'displacement', 'refugee crisis', 'cholera outbreak', 'epidemic', 'pandemic'
    ]

    # Serious but not immediate threats
    high_words = [
        'serious', 'severe', 'significant', 'major', 'escalating', 'worsening',
        'deteriorating', 'alarming', 'concerning', 'malnutrition', 'violence',
        'insecurity', 'humanitarian needs', 'food insecurity'
    ]

    # Moderate concerns
    medium_words = [
        'moderate', 'notable', 'attention', 'monitor', 'watch', 'situation',
        'conditions', 'challenges', 'issues', 'problems'
    ]

    # Count occurrences for better assessment
    critical_count = sum(1 for word in critical_words if word in text_lower)
    high_count = sum(1 for word in high_words if word in text_lower)
    medium_count = sum(1 for word in medium_words if word in text_lower)

    # Weight-based assessment
    if critical_count >= 2 or any(word in text_lower for word in ['famine', 'genocide', 'war', 'crisis']):
        return 'critical'
    elif critical_count >= 1 or high_count >= 2:
        return 'high'
    elif high_count >= 1 or medium_count >= 2:
        return 'medium'
    else:
        return 'low'

