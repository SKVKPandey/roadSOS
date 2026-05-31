"""API v1 blueprint. New endpoint modules register themselves here."""
from flask import Blueprint

api_v1_bp = Blueprint("api_v1", __name__, url_prefix="/api/v1")

# Side-effect imports: each module adds its routes to api_v1_bp on import.
from . import regions  # noqa: E402,F401
