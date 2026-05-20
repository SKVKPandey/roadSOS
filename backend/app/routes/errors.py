from flask import Blueprint, render_template

errors_bp = Blueprint('errors', __name__)

@errors_bp.app_errorhandler(404)
def not_found_error(error):
    """Render custom emergency system 404 page."""
    return render_template('pages/errors/404.html'), 404

@errors_bp.app_errorhandler(500)
def internal_error(error):
    """Render custom emergency system 500 page."""
    return render_template('pages/errors/500.html'), 500
