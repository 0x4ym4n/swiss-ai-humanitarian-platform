import os
from django.core.management.base import BaseCommand, CommandParser

from ...news_ingest import ingest_reliefweb_news, DEFAULT_COLLECTION


class Command(BaseCommand):
    help = "Ingest ReliefWeb news JSON into a Qdrant collection using the existing embedding pipeline."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--path",
            dest="path",
            default=os.environ.get(
                "RELIEFWEB_NEWS_PATH",
                os.path.abspath(os.path.join(os.getcwd(), "data_sources/reliefweb_news_with_details.json")),
            ),
            help="Path to reliefweb_news_with_details.json",
        )
        parser.add_argument(
            "--collection",
            dest="collection",
            default=os.environ.get("RELIEFWEB_NEWS_COLLECTION", DEFAULT_COLLECTION),
            help="Qdrant collection name to upsert into (new collection).",
        )
        parser.add_argument(
            "--limit",
            dest="limit",
            type=int,
            default=None,
            help="Limit number of items for a quick run.",
        )

    def handle(self, *args, **options):
        path = options["path"]
        collection = options["collection"]
        limit = options["limit"]

        # Resolve path with container fallback before proceeding
        if not os.path.exists(path):
            alt = "/data_sources/reliefweb_news_with_details.json"
            if os.path.exists(alt):
                self.stdout.write(self.style.WARNING(f"Provided path not found. Falling back to {alt}"))
                path = alt
            else:
                self.stderr.write(self.style.ERROR(f"File not found: {path}"))
                return

        self.stdout.write(self.style.NOTICE(f"Ingesting ReliefWeb news from {path} into collection '{collection}'"))

        stats = ingest_reliefweb_news(path=path, collection=collection, limit=limit)
        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Total: {stats['total']} | Embedded: {stats['embedded']} | Skipped: {stats['skipped']}"
            )
        )
