"""Trauma-centre orchestration.

This is the only module the routes layer should talk to. It glues
together:
  - spatial helpers (which H3 cell are we in, what's the bbox)
  - the Overpass client (where do facilities come from)
  - the region cache (do we already know this cell)

Negative caching: when Overpass is unreachable we still write a short-lived
"empty" bundle into the cache so we don't spend 20 s per request retrying
a dead upstream. The empty bundle TTL is much shorter than the success TTL
so the next reachable user re-pulls promptly.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from . import spatial
from .overpass import OverpassError, fetch_facilities
from .region_cache import RegionBundle, RegionCache

log = logging.getLogger(__name__)

# When Overpass is down, cache the empty answer for this long before
# trying again. Short enough that recovery is fast; long enough to
# protect us from a hot-path stampede on a flaky network.
NEGATIVE_TTL_SECONDS = 60


def get_or_build_bundle(cache: RegionCache, cell: str) -> RegionBundle:
    bundle = cache.get(cell)
    if bundle is not None:
        return bundle

    bbox = spatial.cell_bbox(cell)
    try:
        centres = fetch_facilities(bbox)
        bundle = RegionBundle(
            cell=cell,
            resolution=spatial.cell_resolution(cell),
            centers=centres,
            generated_at=time.time(),
            source="overpass",
        )
        cache.put(bundle)
        log.info("trauma_centers: built bundle for %s (%d centers)",
                 cell, len(centres))
        return bundle
    except OverpassError as e:
        # 1. Try to serve a stale-but-present bundle.
        stale = cache.get_even_if_expired(cell)
        if stale is not None and stale.centers:
            log.warning("trauma_centers: overpass failed (%s); serving stale", e)
            return RegionBundle(
                cell=stale.cell,
                resolution=stale.resolution,
                centers=stale.centers,
                generated_at=stale.generated_at,
                ttl_seconds=stale.ttl_seconds,
                source="stale-fallback",
            )
        # 2. No stale data either -- cache an empty result for 60 s so
        #    we don't keep timing out on the same cell.
        log.error("trauma_centers: overpass failed and no stale data: %s", e)
        empty = RegionBundle(
            cell=cell,
            resolution=spatial.cell_resolution(cell),
            centers=[],
            ttl_seconds=NEGATIVE_TTL_SECONDS,
            source="empty",
        )
        cache.put(empty)
        return empty


def gather_centers(cache: RegionCache, cells: list[str]) -> list[dict]:
    seen: set[str] = set()
    merged: list[dict] = []
    for cell in cells:
        bundle = get_or_build_bundle(cache, cell)
        for c in bundle.centers:
            cid = c.get("id")
            if cid and cid not in seen:
                seen.add(cid)
                merged.append(c)
    return merged


def nearby_for_point(
    cache: RegionCache,
    lat: float,
    lng: float,
    *,
    k: int = spatial.DEFAULT_NEARBY_K,
    limit: int = 25,
) -> dict:
    centre_cell = spatial.latlng_to_cell(lat, lng)
    cells = spatial.k_ring(centre_cell, k)
    merged = gather_centers(cache, cells)

    ranked = []
    for c in merged:
        d = spatial.haversine_m(lat, lng, c["lat"], c["lng"])
        ranked.append({**c, "distance_m": round(d, 1)})
    ranked.sort(key=lambda c: c["distance_m"])
    ranked = ranked[:limit]

    nearest_d = ranked[0]["distance_m"] if ranked else None
    return {
        "query": {"lat": lat, "lng": lng, "k": k, "limit": limit},
        "center_cell": centre_cell,
        "resolution": spatial.cell_resolution(centre_cell),
        "cells_searched": cells,
        "centers": ranked,
        "nearest_distance_m": nearest_d,
        "generated_at": time.time(),
    }


def prefetch_plan(
    lat: float,
    lng: float,
    *,
    heading_deg: Optional[float],
    speed_mps: Optional[float],
    k: int = spatial.DEFAULT_PREFETCH_K,
) -> dict:
    cells = spatial.forward_wedge_cells(lat, lng, heading_deg, k=k)
    horizon = "high" if (speed_mps or 0) >= 5 else "medium"
    return {
        "from": {"lat": lat, "lng": lng,
                 "heading_deg": heading_deg, "speed_mps": speed_mps},
        "center_cell": spatial.latlng_to_cell(lat, lng),
        "cells": cells,
        "urls": [f"/api/v1/regions/by-cell/{c}" for c in cells],
        "priority": horizon,
        "generated_at": time.time(),
    }
