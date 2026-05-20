from config.base import BaseConfig

class DevelopmentConfig(BaseConfig):
    """Development configurations."""
    DEBUG = True
    TESTING = False
    ENV = 'development'
    
    # We can turn off strict CSRF in development or keep it active for safety
    WTF_CSRF_ENABLED = True
