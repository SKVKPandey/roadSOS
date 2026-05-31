"""/api/v1/regions/* -- the trauma-centre lookup surface.

Contract for clients:
  GET /by-point?lat=&lng=[&k=2][&limit=25]
       -> the canonical "what's near me" call. Returns ranked centres.

  GET /by-cell/<h3>
       -> direct cell bundle (no ranking). Useful for prefetch results
          and offline lookups when the client knows the exact cell.

  GET /prefetch?lat=&lng=&heading=&speed=[&k=3]
       -> returns a list of URLs the client should background-fetch.
          The server does NOT fetch them itself.

  GET /cache/stats
       -> debug-only counters: size, hits, misses, last-saved.
"""
from __future__ import annotations

from flask import current_app, jsonify, request

from app.services import spatial, trauma_centers
from app.services.region_cache import RegionBundle
from . import api_v1_bp


def _cache():
    """Pull the singleton cache off the Flask app."""
    return current_app.extensions["region_cache"]


def _float_arg(name: str, required: bool = True, default: float | None = None) -> float | None:
    raw = request.args.get(name)
    if raw is None or raw == "":
        if required:
            raise ValueError(f"missing required query arg: {name}")
        return default
    try:
        return float(raw)
    except ValueError as e:
        raise ValueError(f"bad float for {name}: {raw}") from e


def _int_arg(name: str, default: int) -> int:
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as e:
        raise ValueError(f"bad int for {name}: {raw}") from e


@api_v1_bp.route("/regions/by-point", methods=["GET"])
def by_point():
    try:
        lat = _float_arg("lat")
        lng = _float_arg("lng")
        k = _int_arg("k", spatial.DEFAULT_NEARBY_K)
        limit = _int_arg("limit", 25)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    result = trauma_centers.nearby_for_point(
        _cache(), lat, lng, k=k, limit=limit
    )
    return jsonify(result)


@api_v1_bp.route("/regions/by-cell/<h3_cell>", methods=["GET"])
def by_cell(h3_cell: str):
    try:
        # Light validation -- H3 ids are 15 hex chars at most resolutions.
        if not (3 <= len(h3_cell) <= 16) or not all(ch in "0123456789abcdef" for ch in h3_cell.lower()):
            return jsonify({"error": "invalid H3 cell"}), 400

        bundle: RegionBundle = trauma_centers.get_or_build_bundle(_cache(), h3_cell)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    data = bundle.to_dict()
    # Surface the boundary geometry too -- handy if the client wants to
    # draw the cell on a map for debugging.
    data["boundary"] = spatial.cell_boundary(bundle.cell)
    return jsonify(data)


@api_v1_bp.route("/regions/prefetch", methods=["GET"])
def prefetch():
    try:
        lat = _float_arg("lat")
        lng = _float_arg("lng")
        heading = _float_arg("heading", required=False, default=None)
        speed = _float_arg("speed", required=False, default=None)
        k = _int_arg("k", spatial.DEFAULT_PREFETCH_K)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    plan = trauma_centers.prefetch_plan(
        lat, lng, heading_deg=heading, speed_mps=speed, k=k
    )
    return jsonify(plan)


@api_v1_bp.route("/regions/cache/stats", methods=["GET"])
def cache_stats():
    return jsonify(_cache().stats())


@api_v1_bp.route("/regions/cache/snapshot", methods=["POST"])
def cache_snapshot():
    """Force an immediate flush to disk. Useful for manual shutdown."""
    _cache().save()
    return jsonify({"ok": True, **_cache().stats()})


# ---------------------------------------------------------------------------
# /api/v1/emergency-numbers/* -- global emergency-number lookup
# ---------------------------------------------------------------------------
import json as _json
import urllib.request as _urlreq

from app.services import emergency_numbers as _emnum


def _country_code_for(lat: float, lng: float) -> str | None:
    """Quick Nominatim reverse to get ISO country code. Cached in
    region_cache under a special key so back-to-back calls are free."""
    cache = _cache()
    key = f"emcc:{round(lat, 1)}:{round(lng, 1)}"  # ~10 km bucket
    cached = cache.get_even_if_expired(key)
    if cached and getattr(cached, "centers", None):
        return cached.centers[0].get("country_code")

    url = (
        f"https://nominatim.openstreetmap.org/reverse?format=json"
        f"&lat={lat}&lon={lng}&zoom=3"
    )
    headers = {
        "User-Agent": "roadSOS/0.1 (cache-only emergency lookup)",
        "Accept": "*/*",
    }
    try:
        req = _urlreq.Request(url, headers=headers)
        with _urlreq.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        code = ((data.get("address") or {}).get("country_code") or "").lower() or None
        # Memoize in the same region cache.
        from app.services.region_cache import RegionBundle
        cache.put(RegionBundle(
            cell=key, resolution=0,
            centers=[{"country_code": code}],
            ttl_seconds=24 * 3600,
            source="emcc-reverse",
        ))
        return code
    except Exception:
        return None


@api_v1_bp.route("/emergency-numbers/by-point", methods=["GET"])
def emergency_numbers_by_point():
    """Reverse-geocode (lat,lng) -> country -> emergency numbers."""
    try:
        lat = _float_arg("lat")
        lng = _float_arg("lng")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    code = _country_code_for(lat, lng)
    bundle = _emnum.get_numbers(code)
    return jsonify({
        "lat": lat,
        "lng": lng,
        "country_code": code,
        "numbers": bundle,
    })


@api_v1_bp.route("/emergency-numbers/by-country/<code>", methods=["GET"])
def emergency_numbers_by_country(code: str):
    return jsonify({
        "country_code": code.lower(),
        "numbers": _emnum.get_numbers(code),
    })


@api_v1_bp.route("/emergency-numbers/all", methods=["GET"])
def emergency_numbers_all():
    """Returns every country we have, for one-time client bulk-caching.
    ~10 KB JSON; cached aggressively by the service worker."""
    return jsonify({"countries": _emnum.all_countries()})
