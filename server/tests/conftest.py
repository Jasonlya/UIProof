import os
from pathlib import Path
import sys
import tempfile

import pytest


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

_db_file = tempfile.NamedTemporaryFile(prefix="uiproof-test-", suffix=".db", delete=False)
_db_file.close()
os.environ["SQLITE_DB_PATH"] = _db_file.name

from app import create_app  # noqa: E402
from models.models import db  # noqa: E402


@pytest.fixture()
def app():
    application = create_app()
    application.config.update(TESTING=True)
    with application.app_context():
        db.drop_all()
        db.create_all()
    yield application
    with application.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()
