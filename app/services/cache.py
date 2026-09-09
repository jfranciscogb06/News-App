"""Optional Redis cache. If Redis is unreachable the app keeps working without it."""
import logging

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)


class Cache:
    def __init__(self, url: str | None = None, ttl: int | None = None) -> None:
        self.url = settings.redis_url if url is None else url
        self.ttl = ttl or settings.cache_ttl
        self._client: redis.Redis | None = None
        self.enabled = bool(self.url)

    async def connect(self) -> None:
        if not self.enabled:
            logger.info("Cache disabled (no REDIS_URL)")
            return
        try:
            self._client = redis.from_url(self.url, decode_responses=True, socket_connect_timeout=2)
            await self._client.ping()
            logger.info("Cache connected: %s", self.url)
        except Exception as e:  # noqa: BLE001
            logger.warning("Redis unavailable (%s); running without cache", e)
            self.enabled = False
            self._client = None

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

    async def get(self, key: str) -> str | None:
        if not self._client:
            return None
        try:
            return await self._client.get(key)
        except Exception as e:  # noqa: BLE001
            logger.warning("Cache get failed: %s", e)
            return None

    async def set(self, key: str, value: str) -> None:
        if not self._client:
            return
        try:
            await self._client.setex(key, self.ttl, value)
        except Exception as e:  # noqa: BLE001
            logger.warning("Cache set failed: %s", e)
