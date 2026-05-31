# Cache-only trauma centre lookup

This document records the MVP design that replaced the "permanent database"
plan with a layered cache stack. It is the working spec for everything in
`app/services/` and `app/static/js/core/trauma-centers.js`.

If you are reading this trying to extend the system, start here. The big
ideas are in this file; the code is the detail.

---

## Why no database

The product brief is "find the nearest trauma centre, work offline, prefetch
where I am going." None of those requirements need a roadSOS-owned database
**as long as we have a reliable upstream that already knows where hospitals
are**. We have one: OpenStreetMap. Wrapping OSM with caches gets us the same
behaviour with zero data-ops cost.

The trade-offs we accepted, documented for future-you:

1. **First-user cold start** in a never-seen H3 cell pays a 2-8 s Overpass round-trip.
2. **No enriched data** (capacity, ETA, internal ratings). OSM tags only.
3. **Overpass rate limits** are real; aggressive caching covers it for now.

We can attach a DB later, alongside the cache, if a real product reason emerges.

---

## Layering

```
+---------------------------------------------------+
| Browser                                           |
|   Service Worker cache (per-resp, SWR)            |  layer 1
|     |                                             |
|     v                                             |
|   IndexedDB stores (regions + centers)            |  layer 2
+---------------------------------------------------+
                       |
                       v  /api/v1/regions/...
+---------------------------------------------------+
| Flask                                             |
|   RegionCache (TTLCache, in-memory)               |  layer 3
|     |                                             |
|     v   on miss / expiry                          |
|   Overpass API (overpass-api.de / kumi mirror)    |  layer 4 = source of truth
+---------------------------------------------------+
```

A read walks downward only as far as it has to. Writes happen on the way
back up: Overpass result is normalised and stored in layer 3, then the
HTTP response gets cached by the SW (layer 1) and the JSON gets written
to IndexedDB (layer 2).

---

## Server modules (`backend/app/services/`)

- **`spatial.py`** -- the only place that imports `h3`. Exposes
  `latlng_to_cell`, `cell_bbox`, `k_ring`, `forward_wedge_cells`,
  `haversine_m`, `bearing_deg`. Cache resolution is **H3 res 7**
  (~5.16 km^2 per cell, ~1.22 km edge). K-ring 2 covers the typical
  "nearby" query (~3.7 km radius). K-ring 5 covers the urban target of
  ~15 km mentioned in `hex_emergency_grid.md`.

- **`overpass.py`** -- minimal HTTP client. Polite User-Agent, 30 s timeout,
  one retry against a second mirror, hard cap on bounding-box size to
  prevent runaway queries. Normalises Overpass nodes/ways/relations into
  one flat list of dicts (`id`, `name`, `lat`, `lng`, `phone`, `address`,
  `tags`, `osm_url`).

- **`region_cache.py`** -- `RegionCache(maxsize, ttl_seconds, snapshot_path)`
  wraps `cachetools.TTLCache`. Persists every 25 writes via pickle to
  `instance/region_cache.pkl` and on interpreter shutdown via `atexit`.
  Two read methods: `get` (TTL-aware) and `get_even_if_expired` (used as a
  stale-fallback when Overpass is down). Thread-safe via a single `RLock`.

- **`trauma_centers.py`** -- the orchestration layer. Public surface:
  `get_or_build_bundle(cache, cell)`, `nearby_for_point(cache, lat, lng, k, limit)`,
  `prefetch_plan(lat, lng, heading_deg, speed_mps, k)`. Negative caching is
  here: a failed Overpass call writes an empty bundle with a 60 s TTL so
  the next request doesn't pay another timeout.

---

## API surface (`/api/v1/regions/`)

| Endpoint | Purpose |
|---|---|
| `GET /by-point?lat=&lng=[&k=2][&limit=25]` | "What's near me?" Ranked by Haversine. |
| `GET /by-cell/<h3>`                        | One cell bundle; used by the prefetcher. |
| `GET /prefetch?lat=&lng=[&heading=][&speed=][&k=3]` | Returns a list of URLs the client should background-fetch. **Server does not fetch them.** |
| `GET /cache/stats`                         | Counters: hits, misses, size, last-saved. Debug. |
| `POST /cache/snapshot`                     | Force a flush to disk. Manual shutdown helper. |

CSRF is disabled for the whole `api_v1` blueprint -- the PWA's background
fetch has no form-CSRF token and these endpoints are GET-only anyway
(except `/cache/snapshot`, which is operator-only and gated on environment
in real deployments).

---

## Client (`app/static/js/core/`)

- **`idb.js`** -- 200-line promise wrapper over IndexedDB. Two object stores:
  `regions` (keyed by cell id) and `centers` (keyed by centre id). Versioned
  schema so migrations are explicit.

- **`trauma-centers.js`** -- `RoadSOSTrauma.getNearby(lat, lng)` calls
  `/by-point`, persists the response to IndexedDB, falls back to IDB on
  network failure. `RoadSOSTrauma.prefetchForward(coords)` calls `/prefetch`,
  then fires background fetches against the returned URLs. The service
  worker SWRs those responses; we also write them straight into IDB so an
  offline cold boot has data.

The forward-prefetcher is wired in `_scripts.html`: `RoadSOSState.subscribe`
calls `prefetchForward(coords)` on every GPS fix. Internal 12 s throttle
prevents Overpass abuse when the GPS pipeline ticks rapidly.

---

## Service worker (`static/service-worker.js`)

Routing rules, in order:

1. `/api/v1/regions/*` -- **stale-while-revalidate** (own cache `roadsos-regions-vN`).
2. `/api/*` other -- **network-only**, returns `{error:"offline"}` 503 on failure.
3. Cross-origin -- SWR in the runtime cache.
4. HTML navigation -- network-first, fallback to cache, fallback to `/offline`.
5. Same-origin static -- SWR.

`CACHE_VERSION` bump is the only way to evict stale shell assets after a
release. Region cache bucket is separate so we can purge regions without
forcing every user to redownload the JS / CSS.

---

## Operational

- Snapshot file: `backend/instance/region_cache.pkl`. Survives Flask
  restarts. Safe to delete to force a cold-start; the running process
  will refuse to load a stale-on-disk entry whose TTL has expired anyway.
- Cache stats endpoint exposes `hits / misses / puts / size / loaded /
  saved`. Wire this to your Grafana later.
- Overpass etiquette: when this project grows past one user, switch to a
  self-hosted Overpass instance (Docker image `wiktorn/overpass-api`) with
  a regional `.pbf` extract.

---

## What's deliberately out of scope for the MVP

1. **No road-network prefetch.** Forward-wedge cells are picked geometrically,
   not by routing graph. Replace with OSRM/GraphHopper later if needed.
2. **No live capacity / bed availability.** OSM doesn't have it.
3. **No client-side H3.** The browser sends raw coords; the server does
   all hex math. We can ship `h3-js` later if we need offline ranking.
4. **No worker pool around Overpass.** Single Flask process; one request
   at a time per cell. Fine until we hit real concurrency.
5. **No admin override / curated list.** When OSM is wrong, we update OSM.
