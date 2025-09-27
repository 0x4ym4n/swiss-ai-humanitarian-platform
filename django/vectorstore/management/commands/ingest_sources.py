import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from vectorstore.ingest import ingest_unstructured_project, ensure_collection
from qdrant_client import QdrantClient


class Command(BaseCommand):
    help = "Ingest ReliefWeb and Swiss Gov Sudan projects JSON into Qdrant via LLM-assisted structuring"

    def add_arguments(self, parser):
        parser.add_argument('--reliefweb', type=str, default='/data_sources/reliefweb_sudan_situation_reports.json')
        parser.add_argument('--swiss', type=str, default='/data_sources/swiss-gov-suudan-projects.json')
        parser.add_argument('--limit', type=int, default=0, help='Optional limit per source')
        parser.add_argument('--lang', type=str, default='en')

    def handle(self, *args, **options):
        reliefweb_path = options['reliefweb']
        swiss_path = options['swiss']
        limit = options['limit']
        lang = options['lang']

        # Clear Qdrant collection first as requested
        try:
            client = QdrantClient(url=os.environ.get('QDRANT_URL', 'http://localhost:6333'))
            # delete if exists
            try:
                client.delete_collection(collection_name='projects')
            except Exception:
                pass
            # recreate with correct vector size from env/settings
            vector_size = int(os.environ.get('EMBEDDING_DIMENSIONS', '1536'))
            ensure_collection(vector_size)
            self.stdout.write(self.style.WARNING("Qdrant collection 'projects' cleared and recreated."))
        except Exception as e:
            raise CommandError(f"Failed to clear Qdrant: {e}")

        def _ingest_reliefweb(item):
            close_old_connections()
            title = item.get('title') or ''
            details = item.get('details') or {}
            article = details.get('article') or ''
            atts_raw = details.get('attachments') or []
            attachments = []
            for a in atts_raw:
                url = a.get('url') or a.get('href')
                if url:
                    attachments.append({'url': url})
            text = "\n\n".join([
                f"Title: {title}",
                f"Organization: {item.get('organization','')}",
                f"Date: {item.get('date','')}",
                f"URL: {item.get('url','')}",
                article
            ])
            ingest_unstructured_project(
                source='ReliefWeb',
                title=title,
                raw_text=text,
                attachments=attachments,
                lang_hint=lang,
                origin_url=item.get('url') or '',
                external_id=item.get('url') or '',
            )

        def _ingest_swiss(item):
            close_old_connections()
            title = item.get('title') or ''
            details = item.get('details') or {}
            fields = [
                ('Country/region', details.get('country_region','')),
                ('Topic', details.get('topic','')),
                ('Period', details.get('period','')),
                ('Budget', details.get('swiss_budget','') or details.get('budget','')),
                ('Background', details.get('background','')),
                ('Objectives', details.get('objectives','')),
                ('Target groups', details.get('target_groups','')),
                ('Outcomes', details.get('outcomes','')),
                ('Results', details.get('results','')),
                ('Directorate', details.get('directorate','')),
                ('Project partners', details.get('project_partners','')),
                ('Coordination', details.get('coordination','')),
                ('Budget details', details.get('budget_details','')),
                ('Project phases', details.get('project_phases','')),
                ('Sector', details.get('sector','')),
                ('Sub-sector', details.get('sub_sector','')),
                ('Aid type', details.get('aid_type','')),
                ('Project number', details.get('project_number','')),
                ('Contact', details.get('contact_info','')),
                ('Embassy contact', details.get('embassy_contact','')),
                ('Partner contact', details.get('partner_contact','')),
                ('Last update', details.get('last_update','')),
                ('Status', details.get('project_status','')),
            ]
            lines = [f"{k}: {v}" for k, v in fields if v]
            if item.get('desc'):
                lines.append(f"Description: {item.get('desc')}")
            lines.append(f"URL: {item.get('url','')}")
            if details.get('start_date') or details.get('end_date'):
                lines.append(f"start_date: {details.get('start_date','')}")
                lines.append(f"end_date: {details.get('end_date','')}")
            if details.get('project_number'):
                lines.append(f"project_number: {details.get('project_number')}")
            text = "\n".join(lines)
            # Build structured overrides from trusted fields
            # Try to parse project number from URL if missing
            url_val = item.get('url') or ''
            proj_num = details.get('project_number','')
            if not proj_num and url_val:
                import re
                m = re.search(r"/(7F\d{5})/", url_val)
                if m:
                    proj_num = m.group(1)

            # Parse start/end from period or top-level time if available
            period_val = details.get('period','') or (item.get('time') or '')
            start_date = details.get('start_date','')
            end_date = details.get('end_date','')
            if (not start_date or not end_date) and period_val and '-' in period_val:
                parts = [p.strip() for p in period_val.replace('\n', ' ').split('-')]
                if len(parts) >= 2:
                    if not start_date:
                        start_date = parts[0]
                    if not end_date:
                        end_date = parts[1]

            overrides = {
                'title': title,
                'country_region': details.get('country_region',''),
                'period': details.get('period','') or (item.get('time') or ''),
                'budget': details.get('swiss_budget','') or details.get('budget',''),
                'budget_details': details.get('budget_details',''),
                'objectives': details.get('objectives',''),
                'results': details.get('results',''),
                'outcomes': details.get('outcomes',''),
                'target_groups': details.get('target_groups',''),
                'sector': details.get('sector',''),
                'sub_sector': details.get('sub_sector',''),
                'aid_type': details.get('aid_type',''),
                'project_number': proj_num,
                'partners': details.get('project_partners',''),
                'directorate': details.get('directorate',''),
                'start_date': start_date,
                'end_date': end_date,
            }
            ingest_unstructured_project(
                source='SDC',
                title=title,
                raw_text=text,
                attachments=[],
                lang_hint=lang,
                origin_url=item.get('url') or '',
                external_id=proj_num or (item.get('url') or ''),
                structured_overrides=overrides,
            )

        total = 0
        # ReliefWeb parallel ingestion (10 workers)
        if os.path.exists(reliefweb_path):
            with open(reliefweb_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.stdout.write(self.style.NOTICE(f"ReliefWeb items: {len(data)}"))
            items = data[:limit] if limit else data
            errs = 0
            with ThreadPoolExecutor(max_workers=50) as executor:
                future_map = {executor.submit(_ingest_reliefweb, item): i for i, item in enumerate(items)}
                for fut in as_completed(future_map):
                    try:
                        fut.result()
                        total += 1
                    except Exception as e:
                        errs += 1
                        self.stderr.write(self.style.WARNING(f"ReliefWeb ingest error: {e}"))
            self.stdout.write(self.style.SUCCESS(f"ReliefWeb processed: {len(items) - errs}/{len(items)}"))

        # SwissGov parallel ingestion (10 workers)
        if os.path.exists(swiss_path):
            with open(swiss_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.stdout.write(self.style.NOTICE(f"SwissGov items: {len(data)}"))
            items = data[:limit] if limit else data
            errs = 0
            with ThreadPoolExecutor(max_workers=10) as executor:
                future_map = {executor.submit(_ingest_swiss, item): i for i, item in enumerate(items)}
                for fut in as_completed(future_map):
                    try:
                        fut.result()
                        total += 1
                    except Exception as e:
                        errs += 1
                        self.stderr.write(self.style.WARNING(f"Swiss ingest error: {e}"))
            self.stdout.write(self.style.SUCCESS(f"SwissGov processed: {len(items) - errs}/{len(items)}"))

        self.stdout.write(self.style.SUCCESS(f"Ingestion complete. Total items processed: {total}"))
