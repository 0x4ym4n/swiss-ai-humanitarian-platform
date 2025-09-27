from django.urls import path
from .views import (
    health,
    qdrant_init,
    qdrant_upsert_sample,
    qdrant_query_sample,
    csrf_token,
    ingest_endpoint,
    rag_query_endpoint,
    news_query_endpoint,
    metrics_overview,
    metrics_partners,
    metrics_outcomes,
    metrics_region_budgets,
    prompt_analytics,
    sources_index,
    download_source,
)

urlpatterns = [
    path('health/', health),
    path('qdrant/init/', qdrant_init),
    path('qdrant/upsert/', qdrant_upsert_sample),
    path('qdrant/query/', qdrant_query_sample),
    path('csrf/', csrf_token),
    path('ingest/', ingest_endpoint),
    path('rag/', rag_query_endpoint),
    path('news/', news_query_endpoint),
    # Analytics & metrics
    path('metrics/overview/', metrics_overview),
    path('metrics/partners/', metrics_partners),
    path('metrics/outcomes/', metrics_outcomes),
    path('metrics/region-budgets/', metrics_region_budgets),
    path('analytics/prompt/', prompt_analytics),
    path('sources/index/', sources_index),
    path('sources/download/<str:name>/', download_source),
]

