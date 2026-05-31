import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env if present. Looked up relative to backend/ so the same file
# works whether you run flask from backend/ or the project root.
load_dotenv(BASE_DIR / '.env')


class BaseConfig:
    """Base configurations."""
    SECRET_KEY = (os.environ.get('SECRET_KEY')
                  or os.environ.get('FLASK_SECRET_KEY')
                  or 'road-sos-secret-key-3948572')

    # Paths configuration
    BASE_DIR = BASE_DIR

    # Database configuration
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL',
        f"sqlite:///{BASE_DIR / 'instance' / 'db.sqlite3'}"
    )

    # Google Maps. The .env labels this GMAPS_EMBED_API_KEY but the same key
    # usually works for the Maps JavaScript API too once you enable that
    # API on the key in Google Cloud Console.
    GMAPS_API_KEY = (os.environ.get('GMAPS_EMBED_API_KEY')
                     or os.environ.get('GOOGLE_MAPS_API_KEY')
                     or '')
