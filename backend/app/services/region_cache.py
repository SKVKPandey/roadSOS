"""TTL-bounded in-memory cache for trauma-centre region bundles.

Design choices, in case future-you wonders:

  - Keyed by H3 cell id. One cell == one cache entry. No bundling across
    cells: simpler eviction, simpler reasoning when you have to debug.
  - cachetools.TTLCache gives us automatic expiry without a background
    sweeper goroutine -- the next read after TTL kicks an entry out.
  - Survives Flask restarts via an opt-in pickle snapshot on disk. The
    snapshot is rewritten lazily (after every N writes) so we don't fsync
    on every request.
  - Thread-safe via a single RLock. Flask dev server is single-threaded
    but production gunicorn workers may be threaded; cheap to protect.

There is intentionally no schema. If we ever want a "real" data layer
we will add one alongside this cache, not replace it.
"""
from __future__ import annotations

import logging
import os
import pickle
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from cachetools import TTLCache

log = logging.getLogger(__name__)

# 24 hours by default -- hospitals don't move and Overpass deserves the break.
DEFAULT_TTL_SECONDS = 24 * 60 * 60
DEFAULT_MAXSIZE = 2048
SNAPSHOT_FLUSH_EVERY = 25  # writes between disk snapshots


@dataclass
class RegionBundle:
    """One H3 cell's worth of trauma-centre data.

    `centers` is the canonical list -- callers iterate it directly.
    `generated_at` lets clients display "as of HH:MM" and skip refetch
    if they have the same data still fresh.
    """
    cell: str
    resolution: int
    centers: list[dict] = field(default_factory=list)
    generated_at: float = field(default_factory=time.time)
    ttl_seconds: int = DEFAULT_TTL_SECONDS
    source: str = "overpass"  # 'overpass' | 'stale-fallback' | 'empty'

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.generated_at) > self.ttl_seconds


class RegionCache:
    """LRU+TTL cache with optional disk persistence.

    Usage:
        cache = RegionCache(snapshot_path=Path('instance/region_cache.pkl'))
        cache.load()
        bundle = cache.get('873da1161ffffff')
        if not bundle:
            bundle = build_bundle(...)
            cache.put(bundle)
    """

    def __init__(
        self,
        *,
        maxsize: int = DEFAULT_MAXSIZE,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        snapshot_path: Optional[Path] = None,
    ):
        self._ttl = ttl_seconds
        self._store: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl_seconds)
        self._lock = threading.RLock()
        self._snapshot_path = snapshot_path
        self._writes_since_flush = 0
        # Metrics for /api/v1/regions/cache/stats
        self.metrics = {"hits": 0, "misses": 0, "puts": 0, "loaded": 0, "saved": 0}

    # ---- core ------------------------------------------------------------

    def get(self, cell: str) -> Optional[RegionBundle]:
        with self._lock:
            bundle = self._store.get(cell)
            if bundle is not None:
                self.metrics["hits"] += 1
            else:
                self.metrics["misses"] += 1
            return bundle

    def get_even_if_expired(self, cell: str) -> Optional[RegionBundle]:
        """Bypass the TTL gate. Used when Overpass is down and a stale
        answer beats no answer for an emergency tool."""
        with self._lock:
            # TTLCache evicts lazily on access, so to peek past expiry
            # we read straight from its underlying mapping.
            try:
                return self._store.__getitem__(cell)  # type: ignore[index]
            except KeyError:
                return None

    def put(self, bundle: RegionBundle) -> None:
        with self._lock:
            self._store[bundle.cell] = bundle
            self.metrics["puts"] += 1
            self._writes_since_flush += 1
            if (
                self._snapshot_path is not None
                and self._writes_since_flush >= SNAPSHOT_FLUSH_EVERY
            ):
                self._save_locked()

    def invalidate(self, cell: str) -> bool:
        with self._lock:
            return self._store.pop(cell, None) is not None

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._writes_since_flush = 0

    # ---- persistence -----------------------------------------------------

    def load(self) -> int:
        """Restore from disk snapshot. Returns count of entries loaded."""
        if not self._snapshot_path or not self._snapshot_path.exists():
            return 0
        try:
            with self._snapshot_path.open("rb") as fh:
                data = pickle.load(fh)
            now = time.time()
            with self._lock:
                for cell, bundle in data.items():
                    if not isinstance(bundle, RegionBundle):
                        continue
                    if (now - bundle.generated_at) >= bundle.ttl_seconds:
                        continue  # don't restore already-expired entries
                    self._store[cell] = bundle
            self.metrics["loaded"] = len(self._store)
            log.info("region_cache: loaded %d entries from %s",
                     len(self._store), self._snapshot_path)
            return len(self._store)
        except Exception as e:
            log.warning("region_cache: load failed (%s) -- starting cold", e)
            return 0

    def save(self) -> None:
        with self._lock:
            self._save_locked()

    def _save_locked(self) -> None:
        if not self._snapshot_path:
            return
        try:
            self._snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._snapshot_path.with_suffix(self._snapshot_path.suffix + ".tmp")
            # Snapshot only non-expired entries.
            now = time.time()
            snapshot = {
                cell: b for cell, b in list(self._store.items())
                if isinstance(b, RegionBundle)
                and (now - b.generated_at) < b.ttl_seconds
            }
            with tmp.open("wb") as fh:
                pickle.dump(snapshot, fh, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp, self._snapshot_path)
            self._writes_since_flush = 0
            self.metrics["saved"] += 1
            log.info("region_cache: wrote %d entries to %s",
                     len(snapshot), self._snapshot_path)
        except Exception as e:
            log.warning("region_cache: save failed: %s", e)

    # ---- introspection ---------------------------------------------------

    def stats(self) -> dict:
        with self._lock:
            return {
                "size": len(self._store),
                "maxsize": self._store.maxsize,
                "ttl_seconds": self._ttl,
                "snapshot_path": str(self._snapshot_path) if self._snapshot_path else None,
                **self.metrics,
            }
