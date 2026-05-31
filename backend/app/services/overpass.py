"""Minimal Overpass API client for hospital / trauma centre lookup.

Why this exists: roadSOS has no permanent database. Whenever the region
cache misses, we query OpenStreetMap via Overpass for facilities inside
a bounding box, then normalise the result into a flat list of dicts
the rest of the app can consume.

Failure handling:
  - 15 s server-side timeout (gets us off a stuck mirror fast).
  - 18 s HTTP read timeout per attempt (slightly above the server one).
  - Try up to 4 mirrors with exponential backoff.
  - Refuse bboxes > 1 deg on a side to protect Overpass and ourselves.
  - Use the compact `nwr[]` selector + regex so the query plan is small.
"""
from __future__ import annotations

import logging
import time
from typing import Iterable

import requests

log = logging.getLogger(__name__)

# Multiple mirrors -- ordered roughly by reliability from India.
# Geographic diversity is the goal: if overpass-api.de is melting,
# kumi (DE) and z (FI) are independent operators on different infra.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)

USER_AGENT = (
    "roadSOS/0.1 (+https://example.com; cache-only emergency trauma lookup) "
    "Python-requests"
)

MAX_BBOX_DEG = 1.0

# Server-side timeout sent INSIDE the QL itself. Keep it under our HTTP
# read timeout so Overpass replies with a 504 (catchable) instead of us
# hanging on a closed socket.
OVERPASS_SERVER_TIMEOUT = 15

# HTTP read timeout per mirror attempt.
HTTP_TIMEOUT_S = 18

# Compact query: `nwr` matches nodes+ways+relations at once,
# regex covers both "hospital" and "trauma_centre" healthcare values.
# `out center tags` returns one centroid per element with its tags.
OVERPASS_QUERY = """
[out:json][timeout:{server_timeout}];
(
  nwr["amenity"="hospital"]({bbox});
  nwr["healthcare"~"^(hospital|trauma_centre)$"]({bbox});
);
out center tags;
"""


class OverpassError(RuntimeError):
    """Raised when Overpass is unreachable or returns an unusable response."""


def fetch_facilities(bbox: tuple[float, float, float, float]) -> list[dict]:
    """Fetch hospital-like facilities inside `bbox` (south, west, north, east).

    Returns a normalised list. Raises OverpassError on transport failure
    so callers can decide whether to fall back to an expired cache entry
    or serve an empty bundle.
    """
    south, west, north, east = bbox
    if (north - south) > MAX_BBOX_DEG or (east - west) > MAX_BBOX_DEG:
        raise OverpassError(f"bbox too large: {bbox}")

    query = OVERPASS_QUERY.format(
        server_timeout=OVERPASS_SERVER_TIMEOUT,
        bbox=f"{south},{west},{north},{east}",
    )

    last_err: OverpassError | None = None
    backoff = 0.5

    for attempt, endpoint in enumerate(OVERPASS_ENDPOINTS):
        try:
            log.info("overpass: hitting %s (attempt %d)", endpoint, attempt + 1)
            t0 = time.time()
            resp = requests.post(
                endpoint,
                data={"data": query},
                headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
                timeout=HTTP_TIMEOUT_S,
            )
            dt = time.time() - t0

            if resp.status_code in (429, 502, 503, 504):
                log.warning("overpass: %s returned %d after %.1fs, trying next mirror",
                            endpoint, resp.status_code, dt)
                last_err = OverpassError(f"HTTP {resp.status_code} from {endpoint}")
                time.sleep(backoff)
                backoff *= 2
                continue

            resp.raise_for_status()
            payload = resp.json()
            elements = payload.get("elements", [])
            log.info("overpass: got %d elements from %s in %.1fs",
                     len(elements), endpoint, dt)
            return _normalise(elements)

        except requests.exceptions.ReadTimeout as e:
            log.warning("overpass: %s timed out (>%.0fs), trying next mirror",
                        endpoint, HTTP_TIMEOUT_S)
            last_err = OverpassError(f"read timeout from {endpoint}")
        except requests.exceptions.ConnectionError as e:
            log.warning("overpass: %s connection error: %s", endpoint, e)
            last_err = OverpassError(f"connection error: {e}")
        except requests.RequestException as e:
            log.warning("overpass: %s failed: %s", endpoint, e)
            last_err = OverpassError(str(e))

        time.sleep(backoff)
        backoff *= 2

    raise OverpassError(f"all {len(OVERPASS_ENDPOINTS)} overpass endpoints failed: {last_err}")


def _normalise(elements: list[dict]) -> list[dict]:
    """Turn raw Overpass elements into the dict shape the app expects."""
    out = []
    for el in elements:
        lat = el.get("lat")
        lng = el.get("lon")
        if lat is None and "center" in el:
            lat = el["center"].get("lat")
            lng = el["center"].get("lon")
        if lat is None or lng is None:
            continue

        tags = el.get("tags", {}) or {}
        out.append({
            "id": f"{el.get('type', 'node')}/{el.get('id')}",
            "name": tags.get("name") or tags.get("operator") or "Unnamed hospital",
            "lat": float(lat),
            "lng": float(lng),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "address": _format_address(tags),
            "tags": {
                "amenity": tags.get("amenity"),
                "healthcare": tags.get("healthcare"),
                "emergency": tags.get("emergency"),
                "operator": tags.get("operator"),
                "operator:type": tags.get("operator:type"),
                "beds": tags.get("beds"),
                "wheelchair": tags.get("wheelchair"),
                "opening_hours": tags.get("opening_hours"),
            },
            "osm_url": f"https://www.openstreetmap.org/{el.get('type')}/{el.get('id')}",
        })
    return out


def _format_address(tags: dict) -> str | None:
    parts = [
        tags.get("addr:housenumber"),
        tags.get("addr:street"),
        tags.get("addr:suburb") or tags.get("addr:neighbourhood"),
        tags.get("addr:city"),
        tags.get("addr:postcode"),
    ]
    parts = [p for p in parts if p]
    return ", ".join(parts) if parts else None
