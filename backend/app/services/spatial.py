"""Spatial helpers built on Uber's H3.

Everything that touches the hex grid lives here. The rest of the codebase
should never `import h3` directly -- if H3 ever changes API or we swap it
for S2, we only update this module.

Resolution choice: we cache at H3 resolution 7 (~1.22 km edge, ~5.16 km^2).
That keeps a single Overpass query small and lets a k-ring of 2 cover the
roughly 4 km radius we care about for a city-grade trauma lookup. A k-ring
of 5 still fits inside ~15 km, matching the doc's urban target.
"""
from __future__ import annotations

import math
from typing import Iterable

import h3

# --- Tunables ---------------------------------------------------------------
# Bumping these is a deliberate decision -- region cache keys are H3 cells at
# this resolution, so changing the value invalidates every previous cache entry.
CACHE_RESOLUTION = 7
DEFAULT_NEARBY_K = 2          # ring radius for the "what's near me" query
DEFAULT_PREFETCH_K = 3        # ring radius the prefetcher will walk forward
PREFETCH_WEDGE_DEG = 90.0     # forward cone width when filtering neighbours
# ----------------------------------------------------------------------------


def latlng_to_cell(lat: float, lng: float, res: int = CACHE_RESOLUTION) -> str:
    """Return the H3 cell id for a lat/lng at the given resolution."""
    return h3.latlng_to_cell(lat, lng, res)


def cell_to_latlng(cell: str) -> tuple[float, float]:
    """Centre of a cell, as (lat, lng)."""
    return h3.cell_to_latlng(cell)


def cell_resolution(cell: str) -> int:
    return h3.get_resolution(cell)


def cell_boundary(cell: str) -> list[list[float]]:
    """Outer ring of a cell as [[lat, lng], ...] in clockwise order.

    Returned in lat/lng (not lng/lat!) so frontend Leaflet / Maplibre can
    consume it directly. Closed ring (first==last) for GeoJSON-friendliness.
    """
    boundary = h3.cell_to_boundary(cell)  # list of (lat, lng)
    ring = [[float(lat), float(lng)] for lat, lng in boundary]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def cell_bbox(cell: str) -> tuple[float, float, float, float]:
    """Axis-aligned bounding box for a cell as (south, west, north, east).

    Used to drive the Overpass `[bbox]` filter. We pad by a few percent so
    points right on the boundary still come back from the API.
    """
    boundary = h3.cell_to_boundary(cell)
    lats = [p[0] for p in boundary]
    lngs = [p[1] for p in boundary]
    south, north = min(lats), max(lats)
    west, east = min(lngs), max(lngs)
    pad_lat = (north - south) * 0.05
    pad_lng = (east - west) * 0.05
    return (south - pad_lat, west - pad_lng, north + pad_lat, east + pad_lng)


def k_ring(cell: str, k: int) -> list[str]:
    """Cell + all neighbours within k steps (k=0 -> just the centre cell)."""
    if k < 0:
        return [cell]
    return list(h3.grid_disk(cell, k))


def grid_distance(a: str, b: str) -> int:
    """Hex-distance between two cells at the same resolution."""
    try:
        return h3.grid_distance(a, b)
    except Exception:
        # Cross-pentagon edge cases can raise; treat as far away.
        return 99


# --- Geometry utilities -----------------------------------------------------

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial compass bearing from (lat1,lng1) to (lat2,lng2), in degrees [0,360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
    theta = math.degrees(math.atan2(y, x))
    return (theta + 360.0) % 360.0


def _angular_diff(a: float, b: float) -> float:
    """Smallest absolute difference between two compass bearings (0..180)."""
    d = abs(a - b) % 360.0
    return d if d <= 180.0 else 360.0 - d


# --- Predictive prefetch wedge ---------------------------------------------

def forward_wedge_cells(
    lat: float,
    lng: float,
    heading_deg: float | None,
    *,
    k: int = DEFAULT_PREFETCH_K,
    wedge_deg: float = PREFETCH_WEDGE_DEG,
) -> list[str]:
    """Return the H3 cells the user is likely to enter next.

    Picks the centre cell plus every cell in a k-ring whose bearing from
    the centre lies inside a `wedge_deg` cone around `heading_deg`. With
    `heading_deg=None` (device sitting still), we fall back to a full
    k-ring so the cache still gets a useful warm-up.

    Returns cells ordered by hex-distance ascending so callers can
    prioritise the closest ones first.
    """
    centre = latlng_to_cell(lat, lng)
    if heading_deg is None or not math.isfinite(heading_deg):
        # No direction known -- warm the whole neighbourhood.
        cells = k_ring(centre, k)
    else:
        half = wedge_deg / 2.0
        cells = [centre]
        c_lat, c_lng = cell_to_latlng(centre)
        for cell in k_ring(centre, k):
            if cell == centre:
                continue
            n_lat, n_lng = cell_to_latlng(cell)
            b = bearing_deg(c_lat, c_lng, n_lat, n_lng)
            if _angular_diff(b, heading_deg) <= half:
                cells.append(cell)

    cells.sort(key=lambda c: grid_distance(centre, c))
    return cells


def cells_for_radius_km(lat: float, lng: float, radius_km: float) -> list[str]:
    """Pick a k-ring big enough to cover `radius_km`, return its cells.

    Useful when a caller asks "give me everything within 10 km" and we need
    to pick the smallest k that covers it.
    """
    if radius_km <= 0:
        return [latlng_to_cell(lat, lng)]
    # H3 res 7 edge ~1.22 km. radius_km / 1.22 cells per direction, +1 for safety.
    edge_km = 1.22
    k = max(1, math.ceil(radius_km / edge_km) + 1)
    return k_ring(latlng_to_cell(lat, lng), k)


def closest_centre(
    target_lat: float,
    target_lng: float,
    centres: Iterable[dict],
) -> tuple[dict | None, float | None]:
    """Pick the closest centre (by Haversine) and return (centre, distance_m).

    Used for the "your nearest trauma centre right now" UI. Hex membership
    is a coarse filter; the final ranking is always real great-circle
    distance from the precise GPS fix.
    """
    best, best_d = None, None
    for c in centres:
        d = haversine_m(target_lat, target_lng, c["lat"], c["lng"])
        if best_d is None or d < best_d:
            best, best_d = c, d
    return best, best_d
