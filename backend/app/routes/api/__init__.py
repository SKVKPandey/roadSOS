"""API namespace. Versioned blueprints live in sub-packages."""
from .v1 import api_v1_bp  # re-export so the factory can register it

__all__ = ["api_v1_bp"]
