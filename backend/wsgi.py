import os
from dotenv import load_dotenv
from app import create_app

# Load environment configs
load_dotenv()

app = create_app()

if __name__ == '__main__':
    # Defaulting to 127.0.0.1 on port 5000 in development
    app.run(
        host=os.environ.get('FLASK_RUN_HOST', '127.0.0.1'),
        port=int(os.environ.get('FLASK_RUN_PORT', 5000)),
        debug=app.config.get('DEBUG', True)
    )
