# roadSOS

> One tap. One rescue. Global, offline-ready emergency dispatch.

roadSOS is the Round 1 submission of **Team roadSOS** to the **IIT Madras
National Road Safety Hackathon 2026**, under the theme *Locator for Road
Crash Emergency Services*.

The application combines a Flask backend, a Progressive Web App
frontend, and a Capacitor-wrapped Android APK into a single deployable
system that:

- locates the nearest police stations, hospitals, ambulance services,
  towing operators, puncture shops and showrooms around the user,
- provides a one-tap dial to the correct **local** emergency number in
  any of **57** supported countries,
- continues working **offline** through layered caches, and
- ships as both a PWA (for any browser) and a native Android APK (for
  full GPS accuracy via `FusedLocationProviderClient`).

---

## Quick start

### Prerequisites

| Tool | Minimum version | Used for |
|---|---|---|
| Python | 3.10 | Flask backend |
| Node.js | 18 LTS | Capacitor build |
| JDK | 17 | Android Gradle build (avoid 21+) |
| Android Studio | latest | Building the APK |
| Android SDK | API 34 | APK target |

### 1. Run the backend (and the PWA)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
flask run --host=0.0.0.0
```

`--host=0.0.0.0` is required so your phone (on the same Wi-Fi) can
reach Flask. Open `http://localhost:5000` for the PWA, or
`http://<your-lan-ip>:5000` from a phone browser.

### 2. Build the Android APK

```powershell
cd mobile
npm install
# Patch capacitor.config.json with your laptop's LAN IP (one-time per network change)
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.PrefixOrigin -eq 'Dhcp' -and $_.IPAddress -like '192.168.*' } |
       Select-Object -First 1).IPAddress
(Get-Content capacitor.config.json) -replace '__LAN_IP__', $ip |
       Set-Content capacitor.config.json

npx cap sync android
npx cap open android
```

In Android Studio: plug in a phone with USB debugging enabled → press
the green **Run ▶**. The APK installs and launches automatically.

### 3. Environment variables (`backend/.env`)

```
FLASK_SECRET_KEY=...
GMAPS_EMBED_API_KEY=AIza...      # also enable Maps JavaScript API on the key
GOOGLE_CLIENT_ID=...             # optional, OAuth login
GOOGLE_CLIENT_SECRET=...
OPENAI_API_KEY=...               # optional, future LLM features
```

A sample `.env` is shipped in the repo. **Rotate the keys before any
public deployment.**

---

## Repository layout

```
roadSOS/
├── backend/                       # Flask backend + PWA frontend
│   ├── app/
│   │   ├── __init__.py            # application factory + context processors
│   │   ├── routes/
│   │   │   ├── home.py            # /, /services, /map, /profile, PWA infra
│   │   │   ├── auth.py            # signup / login (Flask-WTF)
│   │   │   ├── errors.py          # 404 / 500 handlers
│   │   │   └── api/v1/
│   │   │       ├── __init__.py    # API v1 blueprint
│   │   │       └── regions.py     # /regions/* + /emergency-numbers/*
│   │   ├── services/              # CACHE-ONLY SPINE
│   │   │   ├── spatial.py         # H3 wrappers; the rest of the codebase
│   │   │   │                      # never imports h3 directly
│   │   │   ├── overpass.py        # Overpass HTTP client + 4-mirror failover
│   │   │   ├── region_cache.py    # TTL cache + pickle snapshot persistence
│   │   │   ├── trauma_centers.py  # orchestration of spatial + overpass +
│   │   │   │                      # negative cache
│   │   │   └── emergency_numbers.py  # 57-country emergency-number registry
│   │   ├── templates/
│   │   │   ├── layouts/base.html  # shell + bottom nav + location pill
│   │   │   ├── partials/_head.html, _scripts.html
│   │   │   └── pages/
│   │   │       ├── home/index.html        # giant SOS button
│   │   │       ├── services/index.html    # verify-service page (with map CTA)
│   │   │       ├── services/nearby.html   # live ranked list of facilities
│   │   │       ├── services/detail.html   # tap-to-call individual facility
│   │   │       ├── map/index.html         # Google Maps + H3 overlay
│   │   │       ├── profile/medical_card.html
│   │   │       └── errors/{404,500,offline}.html
│   │   └── static/
│   │       ├── js/
│   │       │   ├── main.js                # GPS pipeline + Capacitor shim +
│   │       │   │                          # accuracy gate + best-of-N
│   │       │   └── core/
│   │       │       ├── state.js
│   │       │       ├── api.js
│   │       │       ├── idb.js             # IndexedDB v2 wrapper
│   │       │       ├── trauma-centers.js
│   │       │       ├── medical-card.js
│   │       │       └── emergency-numbers.js
│   │       ├── css/  (vanilla CSS, no Tailwind, no preprocessor)
│   │       ├── icons/  (PWA + apple-touch + favicon)
│   │       ├── service-worker.js          # cache-first shell + SWR regions
│   │       └── manifest.webmanifest       # PWA manifest
│   ├── config/  base / development / production
│   ├── instance/  (gitignored)            # region_cache.pkl snapshot
│   ├── requirements.txt
│   └── wsgi.py
│
├── mobile/                        # Capacitor APK wrapper
│   ├── capacitor.config.json      # __LAN_IP__ placeholder, patched per network
│   ├── package.json
│   ├── www/index.html             # offline placeholder
│   ├── README.md                  # mobile-specific build instructions
│   └── android/                   # generated by `npx cap add android`
│
└── docs/                          # design + architecture documents
    ├── cache_architecture.md      # full layered-cache design doc
    ├── hex_emergency_grid.md      # H3 hexagonal grid background
    ├── frontend.md                # frontend architecture
    └── design_system.md           # color tokens, typography, components
```

---

## Architecture in one diagram

```
┌─────────────────────────── PHONE ────────────────────────────┐
│  Capacitor APK  /  Progressive Web App                       │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐   ┌─────────────────┐  │
│  │ Service      │    │ IndexedDB v2 │   │ localStorage    │  │
│  │ Worker cache │    │  regions     │   │  medical card   │  │
│  │              │    │  centers     │   │  location toggle│  │
│  └──────────────┘    │  em_numbers  │   └─────────────────┘  │
│                      │  kv          │                        │
│                      └──────────────┘                        │
│                                                              │
│  main.js          + native GPS via Capacitor.Geolocation     │
│  trauma-centers.js + h3-js for client-side polygons           │
│  emergency-numbers.js (bulk-cache 57 countries on first run) │
└─────────────────────┬────────────────────────────────────────┘
                      │  http://lan-ip:5000
                      ▼
┌─────────────────────────── EDGE  (Flask) ────────────────────┐
│  /api/v1/regions/by-point                                    │
│  /api/v1/regions/by-cell/<h3>                                │
│  /api/v1/regions/prefetch?lat=&lng=&heading=&speed=          │
│  /api/v1/emergency-numbers/by-point                          │
│  /api/v1/emergency-numbers/all  (57 countries, ~10 KB)       │
│                                                              │
│  ┌─ region_cache.RegionCache ──────────────────────────────┐ │
│  │  cachetools.TTLCache + pickle snapshot in instance/     │ │
│  │  24h TTL · maxsize 2048 · negative cache (60s on fail)  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────── OPEN-DATA SOURCES ────────────────┐
│  OpenStreetMap Overpass         (4-mirror failover)          │
│  OpenStreetMap Nominatim        (reverse-geocode + country)  │
│  Google Maps JavaScript API     (political view, key in .env)│
└──────────────────────────────────────────────────────────────┘
```

Every layer is a cache. OpenStreetMap is the source of truth. The user
pays the upstream cost at most once per cell per day.

---

## Why H3 hexagons?

We chose Uber's H3 over more familiar approaches (lat/lng rectangles,
QuadTree, GeoHash) for four concrete reasons:

1. **Equal-area cells.** A hexagon at resolution 7 covers roughly
   5.16 km² regardless of latitude. lat/lng rectangles distort as you
   move toward the poles.
2. **Uniform neighbour distance.** Each hex has 6 equidistant
   neighbours; "nearest cell" queries are simpler and fairer.
3. **Cache-friendly ID space.** One H3 ID = one URL = one IndexedDB
   row. Two phones 50 m apart in the same cell hit the same key.
4. **Hierarchical zoom.** The same cell ID can be promoted to a coarser
   parent or refined to children without rewriting the cache.

We use H3 resolution 7 with k-ring 2 for "nearby" (≈98 km², 19 cells)
and forward-wedge prefetch driven by heading + speed for predictive
loading.

---

## Why a cache-only architecture?

There is no roadSOS-owned database. OpenStreetMap is the canonical
source of truth, and every layer below it caches a slice of OSM that
the current user cares about. This decision gives us:

- **Global coverage from day one** — OSM is community-maintained in
  every country.
- **Zero data-ops cost** — we never re-curate hospital lists.
- **Trivial offline survival** — a cache that has rendered once,
  renders again when the network drops.
- **Predictable cache keys** — every layer uses the H3 cell ID, so
  invalidation is a non-problem (cells never overlap, IDs never
  change).

Failure recovery is built in: 4 Overpass mirrors, negative caching on
failure (60s TTL), stale-while-revalidate at the Service Worker, and
last-known-country persistence for the emergency-number registry.

---

## API surface

All endpoints under `/api/v1/`:

| Method | Path | Returns |
|---|---|---|
| GET | `/regions/by-point?lat=&lng=&k=&limit=` | Ranked facilities near a point |
| GET | `/regions/by-cell/<h3>` | One cell's region bundle |
| GET | `/regions/prefetch?lat=&lng=&heading=&speed=` | List of URLs the client should background-fetch |
| GET | `/regions/cache/stats` | Cache hit/miss counters |
| POST | `/regions/cache/snapshot` | Force a flush to disk |
| GET | `/emergency-numbers/by-point?lat=&lng=` | Country-localised emergency numbers |
| GET | `/emergency-numbers/by-country/<iso2>` | Same, by explicit country |
| GET | `/emergency-numbers/all` | Full registry of 57 countries (bulk-cache) |
| GET | `/geocode?lat=&lng=` | Nominatim reverse-geocode proxy |

---

## PWA & service worker

- Shell precache on install: HTML pages, CSS, JS modules, icons,
  manifest, offline page, and the `/emergency-numbers/all` registry.
- **Region API** uses stale-while-revalidate so previously seen cells
  render instantly and refresh in the background.
- **Geocode API** is network-only (must be fresh).
- **Cross-origin assets** (Google Maps tiles, h3-js CDN) use a runtime
  cache.
- Manifest declares `display: standalone`, theme color `#f4c89a`, and
  two shortcuts (Call 112 / Find services).

The bump `CACHE_VERSION = 'v2'` in `service-worker.js` is the only
versioning needed when shell files change.

---

## Capacitor & native GPS

The same `main.js` runs in both contexts. A tiny compat shim picks the
right geolocation source automatically:

- **Browser PWA** → `navigator.geolocation.*` (browser-smoothed,
  no A-GPS, ±200–500 m in urban canyons).
- **Capacitor APK** → `window.Capacitor.Plugins.Geolocation.*` which
  wraps `FusedLocationProviderClient` (full sensor fusion + A-GPS +
  Google Wi-Fi BSSID database, ±10–25 m in urban canyons).

On top of that we apply best-of-N selection (lowest accuracy radius in
the last 30 s), an accuracy gate at 80 m for the reverse-geocoder, and
a 15 s forced refresh to defeat OS-level position caching.

`mobile/android/app/src/main/AndroidManifest.xml` requests
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, and `INTERNET`.

---

## Region-aware emergency numbers

`backend/app/services/emergency_numbers.py` curates 57 countries with
localised police / ambulance / fire / unified bundles. The client:

1. On first online launch, bulk-downloads the full registry (~10 KB
   JSON) into IndexedDB with a 14-day TTL.
2. On every GPS fix, calls `/api/v1/emergency-numbers/by-point`, which
   reverse-geocodes via Nominatim → ISO 3166-1 alpha-2 → registry
   lookup, and caches the result.
3. Persists "last known country" so a cold offline launch still has a
   sensible number.
4. Falls back to **GSM 112** for any country not in the registry —
   most mobile networks route 112 correctly worldwide even when
   roaming.

The SOS button reads `RoadSOSEmergency.getDialableAll()` and invokes
`tel:<number>` — Android's system dialer opens with the number
pre-filled.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npx cap add android` fails: Gradle download timeout | Manually download `gradle-8.2.1-all.zip` to `~/.gradle/wrapper/dists/gradle-8.2.1-all/<hash>/` |
| `flask run` ImportError: `cachetools` | `pip install -r requirements.txt` again (loose pins in newer Python) |
| `adb devices` shows `unauthorized` | Accept the USB-debug RSA prompt on the phone; `adb kill-server && adb start-server` |
| Map area blank in APK | Enable **Maps JavaScript API** on the key in Google Cloud Console; if restricted to a domain, add your LAN IP / `*.local` |
| Phone says "site can't be reached" when opening LAN IP | Windows Firewall: `New-NetFirewallRule -DisplayName "Flask 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow` |
| GPS pill stuck on "Improving lock... ±N m" | Move outdoors with sky view; the gate is set to ±80 m (urban-canyon realistic) |

The on-page **GPS Debug** panel (bottom-right pill on every page)
shows every fix, every API call, every cache decision in real time —
invaluable for triage.

---

## Design docs

Full architectural rationale lives under `docs/`:

- `docs/cache_architecture.md` — layered cache spine and trade-offs.
- `docs/hex_emergency_grid.md` — H3 background and prefetch heuristics.
- `docs/frontend.md` — frontend module map.
- `docs/design_system.md` — colors, type, components, motion.

---

## Future scope

See section 9 of the detailed project document for the full list. In
short: SMS-fallback dispatch, emergency-contact CRUD with live-share
links, onboarding wizard, map-matching to road centrelines, server-side
incident log, self-hosted Overpass mirror, multi-language UI, and
voice / fall-detection triggers — none of which require breaking the
cache spine.

---

## License

MIT (placeholder). To be confirmed before public release.

## Team

Team **roadSOS**, for the IIT Madras National Road Safety Hackathon 2026.
