import atexit
from pathlib import Path

from flask import Flask
from flask_wtf.csrf import CSRFProtect
from config import get_config

csrf = CSRFProtect()


def create_app():
    """Application factory for roadSOS Flask App."""
    app = Flask(
        __name__,
        static_folder='static',
        template_folder='templates'
    )

    # Load configuration
    app.config.from_object(get_config())

    # Initialize extensions
    csrf.init_app(app)

    # -----------------------------------------------------------------
    # Region cache (cache-only trauma-centre store -- no DB).
    # Snapshot lives under `instance/` so it survives Flask restarts.
    # -----------------------------------------------------------------
    from app.services.region_cache import RegionCache

    instance_dir = Path(app.instance_path)
    instance_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = instance_dir / "region_cache.pkl"

    region_cache = RegionCache(snapshot_path=snapshot_path)
    region_cache.load()
    app.extensions["region_cache"] = region_cache

    # Best-effort flush on interpreter shutdown.
    atexit.register(region_cache.save)

    # -----------------------------------------------------------------
    # Blueprints
    # -----------------------------------------------------------------
    from app.routes.home import home_bp
    from app.routes.auth import auth_bp
    from app.routes.errors import errors_bp
    from app.routes.api import api_v1_bp

    app.register_blueprint(home_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(errors_bp)
    app.register_blueprint(api_v1_bp)

    # The API blueprint is JSON-only; exempt it from CSRF so the PWA's
    # background prefetch (which has no form-CSRF token) can hit it.
    csrf.exempt(api_v1_bp)


    # Pass GMAPS API key into all templates -- used by /map page.
    @app.context_processor
    def inject_gmaps_key():
        return {"gmaps_api_key": app.config.get("GMAPS_API_KEY", "")}

    return app
