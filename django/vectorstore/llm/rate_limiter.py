"""Simple thread-safe rate limiter utilities."""
from collections import deque
from typing import Deque, Dict
import threading
import time


class RateLimiter:
    """Token bucket style limiter that allows up to ``max_calls`` per ``period`` seconds."""

    def __init__(self, max_calls: int, period: float) -> None:
        self.max_calls = max_calls
        self.period = period
        self._timestamps: Deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        """Block until a slot is available within the rate limit window."""
        while True:
            with self._lock:
                now = time.monotonic()
                window_start = now - self.period

                # Drop timestamps that fell outside the sliding window.
                while self._timestamps and self._timestamps[0] <= window_start:
                    self._timestamps.popleft()

                if len(self._timestamps) < self.max_calls:
                    self._timestamps.append(now)
                    return

                sleep_for = self.period - (now - self._timestamps[0])

            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                # In pathological cases just yield control briefly.
                time.sleep(0)


_LIMITERS: Dict[str, RateLimiter] = {}
_LIMITERS_LOCK = threading.Lock()


def get_rate_limiter(name: str, max_calls: int, period: float) -> RateLimiter:
    """Return a shared rate limiter instance keyed by ``name`` and parameters."""
    key = f"{name}:{max_calls}:{period}"
    with _LIMITERS_LOCK:
        limiter = _LIMITERS.get(key)
        if limiter is None:
            limiter = RateLimiter(max_calls=max_calls, period=period)
            _LIMITERS[key] = limiter
        return limiter
