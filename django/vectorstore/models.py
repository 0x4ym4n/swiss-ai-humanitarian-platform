from django.db import models


class Document(models.Model):
    source = models.CharField(max_length=255)
    external_id = models.CharField(max_length=255, blank=True, default='')
    title = models.TextField()
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.source} | {self.title[:80]}"



