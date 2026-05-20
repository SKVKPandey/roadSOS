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
    
    # Register blueprints
    from app.routes.home import home_bp
    from app.routes.auth import auth_bp
    from app.routes.errors import errors_bp
    
    app.register_blueprint(home_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(errors_bp)
    
    return app
