import os
from config.base import BaseConfig
from config.development import DevelopmentConfig

# Config class mapping
config_by_name = {
    'development': DevelopmentConfig,
    'default': DevelopmentConfig,
    'base': BaseConfig
}

def get_config():
    """Retrieve config class based on FLASK_ENV env variable."""
    env = os.environ.get('FLASK_ENV', 'development')
    return config_by_name.get(env, config_by_name['default'])
