import sys
import os
# 同时保留 server/ 与项目根目录，兼容 `python app.py` 和 `python -m server.app`
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SERVER_DIR)
sys.path.insert(0, SERVER_DIR)
sys.path.insert(0, PROJECT_ROOT)

from flask import Flask
from flask_cors import CORS
import logging
from logging.handlers import RotatingFileHandler
from config import Config
from models.models import db
from routes import register_routes

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config['SERVER_PORT'] = int(os.environ.get('PORT', '5001'))
    app.config['DEBUG'] = os.environ.get('FLASK_DEBUG') == '1'

    db.init_app(app)
    CORS(app)

    configure_logging(app)
    register_routes(app)

    # 数据库初始化：自动创建新表（包括 StepSnapshot）
    with app.app_context():
        os.makedirs(app.instance_path, exist_ok=True)
        from models.models import StepSnapshot
        db.create_all()

    return app

def configure_logging(app):
    if not app.debug:
        log_dir = os.path.join(app.root_path, 'logs')
        os.makedirs(log_dir, exist_ok=True)

        file_handler = RotatingFileHandler(
            os.path.join(log_dir, 'app.log'),
            maxBytes=10240,
            backupCount=10,
        )
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        file_handler.setLevel(logging.INFO)
        app.logger.addHandler(file_handler)

        app.logger.setLevel(logging.INFO)
        app.logger.info('服务端启动')

app = create_app()

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(
        debug=app.config['DEBUG'],
        host='0.0.0.0',
        port=app.config['SERVER_PORT'],
    )
