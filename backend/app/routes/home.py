from flask import Blueprint, render_template, abort

home_bp = Blueprint('home', __name__)


# ---------------------------------------------------------------------------
# Hard-coded service registry (stand-in until backend data is wired).
# Each entry powers both the service-grid tile AND the detail page.
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
        'description': 'Unified emergency dispatcher — routes to whichever agency you need.',
        'phone': '112',
    },
}

# Ordered list for grid rendering (matches mockup left-to-right, top-to-bottom)
SERVICE_ORDER = ['ambulance', 'trauma', 'police', 'tow', 'tyre-fuel', 'all-112']


@home_bp.route('/')
def index():
    """Giant SOS tap — primary screen."""
    return render_template('pages/home/index.html', active_tab='sos')


@home_bp.route('/services')
def services():
    """Service grid — 2x3 pastel tiles for picking a specific responder."""
    tiles = [SERVICES[slug] for slug in SERVICE_ORDER]
    return render_template(
        'pages/services/index.html',
        active_tab='map',
        services=tiles,
    )


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
