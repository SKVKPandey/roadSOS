from flask import (
    Blueprint, render_template, abort, request, jsonify,
    send_from_directory, current_app, make_response,
)
import urllib.request
import json
import os

home_bp = Blueprint('home', __name__)


# ---------------------------------------------------------------------------
# Hard-coded service registry (stand-in until the cache-based trauma centre
# pipeline replaces it for the hospital/trauma categories). Other services
# (tow, fuel, police) still come from here.
# ---------------------------------------------------------------------------
SERVICES = {
    'ambulance': {
        'slug': 'ambulance',
        'name': 'Apollo Ambulance',
        'short': 'Ambulance',
        'glyph': 'A',
        'tile_color': 'tile-ambulance',
        'distance_km': 0.5,
        'eta_min': 2,
        'route_label': 'via OMR',
        'open_now': True,
        'tags': ['BLS unit', 'Oxygen', 'AED', '24x7'],
        'description': 'Closest dispatchable ambulance with on-board paramedic.',
        'phone': '+91-1066',
    },
    'trauma': {
        'slug': 'trauma',
        'name': 'Apollo Trauma Ctr.',
        'short': 'Trauma',
        'glyph': 'H',
        'tile_color': 'tile-trauma',
        'distance_km': 2.1,
        'eta_min': 6,
        'route_label': 'via OMR',
        'open_now': True,
        'tags': ['Level 1 trauma', 'CT scan', 'Blood bank', '24x7'],
        'description': 'Level-1 trauma facility with on-call surgical team.',
        'phone': '+91-44-2829-3333',
    },
    'police': {
        'slug': 'police',
        'name': 'Adyar Police Stn.',
        'short': 'Police',
        'glyph': 'P',
        'tile_color': 'tile-police',
        'distance_km': 1.4,
        'eta_min': 4,
        'route_label': 'via LB Road',
        'open_now': True,
        'tags': ['24x7', 'PCR van', 'Beat patrol'],
        'description': 'Local jurisdiction station for immediate response.',
        'phone': '100',
    },
    'tow': {
        'slug': 'tow',
        'name': 'RoadHelp Towing',
        'short': 'Tow',
        'glyph': 'T',
        'tile_color': 'tile-tow',
        'distance_km': 3.2,
        'eta_min': 12,
        'route_label': 'via ECR',
        'open_now': True,
        'tags': ['Flatbed', 'Recovery', 'Up to 3.5T'],
        'description': 'Flatbed and dolly tow within 25 km radius.',
        'phone': '+91-90000-12345',
    },
    'tyre-fuel': {
        'slug': 'tyre-fuel',
        'name': 'PitStop Tyre & Fuel',
        'short': 'Tyre / Fuel',
        'glyph': '#',
        'tile_color': 'tile-fuel',
        'distance_km': 0.6,
        'eta_min': 5,
        'route_label': 'via Sardar Patel Rd',
        'open_now': True,
        'tags': ['Puncture', 'Fuel 5L', 'Battery jump'],
        'description': 'Mobile mechanic for puncture, fuel and jumpstart.',
        'phone': '+91-90000-67890',
    },
    'all-112': {
        'slug': 'all-112',
        'name': 'All-Service 112',
        'short': 'ALL-112',
        'glyph': '!',
        'tile_color': 'tile-all112',
        'distance_km': None,
        'eta_min': None,
        'route_label': 'Unified dispatch',
        'open_now': True,
        'tags': ['Ambulance', 'Police', 'Fire', 'Disaster'],
        'description': 'Unified emergency dispatcher - routes to whichever agency you need.',
        'phone': '112',
    },
}

SERVICE_ORDER = ['ambulance', 'trauma', 'police', 'tow', 'tyre-fuel', 'all-112']


@home_bp.route('/')
def index():
    """Giant SOS tap - primary screen."""
    return render_template('pages/home/index.html', active_tab='sos')


@home_bp.route('/services')
def services():
    """Service grid - 2x3 pastel tiles for picking a specific responder."""
    tiles = [SERVICES[slug] for slug in SERVICE_ORDER]
    return render_template(
        'pages/services/index.html',
        active_tab='map',
        services=tiles,
    )


@home_bp.route('/services/nearby')
def services_nearby():
    """Live list of nearest trauma centres, populated client-side from
    /api/v1/regions/by-point once the GPS pill is on."""
    return render_template(
        'pages/services/nearby.html',
        active_tab='map',
    )


@home_bp.route('/map')
def map_view():
    """Leaflet map with current location, H3 hex overlay, and trauma centres."""
    return render_template('pages/map/index.html', active_tab='map')


@home_bp.route('/profile')
def profile():
    """Medical card profile. Stored in localStorage, no DB."""
    return render_template('pages/profile/medical_card.html', active_tab='profile')


@home_bp.route('/services/<slug>')
def service_detail(slug):
    """Detail page for a specific responder (hospital, police, tow, ...)."""
    svc = SERVICES.get(slug)
    if not svc:
        abort(404)
    return render_template(
        'pages/services/detail.html',
        active_tab='map',
        svc=svc,
    )


# ---------------------------------------------------------------------------
# PWA infrastructure routes
# ---------------------------------------------------------------------------
@home_bp.route('/service-worker.js')
def service_worker():
    """Served from the site root so the worker's scope covers everything."""
    static_dir = os.path.join(current_app.root_path, 'static')
    response = make_response(send_from_directory(static_dir, 'service-worker.js'))
    response.headers['Content-Type'] = 'application/javascript; charset=utf-8'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@home_bp.route('/manifest.webmanifest')
def web_manifest():
    """Serve the PWA manifest at a stable root-level URL."""
    static_dir = os.path.join(current_app.root_path, 'static')
    response = make_response(send_from_directory(static_dir, 'manifest.webmanifest'))
    response.headers['Content-Type'] = 'application/manifest+json'
    return response


@home_bp.route('/offline')
def offline():
    """Fallback page used by the service worker when navigation fails."""
    return render_template('pages/errors/offline.html', active_tab='sos')


# ---------------------------------------------------------------------------
# Legacy geocode proxy (kept here for back-compat; new code under /api/v1).
# ---------------------------------------------------------------------------
@home_bp.route('/api/v1/geocode')
def geocode():
    """Backend proxy to fetch reverse geocoding from Nominatim."""
    lat = request.args.get('lat')
    lng = request.args.get('lng')
    if not lat or not lng:
        return jsonify({'error': 'Missing lat or lng'}), 400

    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=16"
        headers = {
            'User-Agent': 'roadSOS-web-app/1.0 (contact: support@roadsos.com)',
            'Accept-Language': 'en',
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            return jsonify(res_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
