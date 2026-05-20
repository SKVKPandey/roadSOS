import os
from pathlib import Path

class BaseConfig:
    """Base configurations."""
    SECRET_KEY = os.environ.get('SECRET_KEY', 'road-sos-secret-key-3948572')
    
    # Paths configuration
    BASE_DIR = Path(__file__).resolve().parent.parent
    
    # Database configuration
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL', 
        f"sqlite:///{BASE_DIR / 'instance' / 'db.sqlite3'}"
    )
