import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


SERVER_DIR = Path(__file__).resolve().parent
DEFAULT_SQLITE_PATH = SERVER_DIR / 'instance' / 'automation_cases.db'

_sqlite_path = Path(os.environ.get('SQLITE_DB_PATH', DEFAULT_SQLITE_PATH)).expanduser()
if not _sqlite_path.is_absolute():
    _sqlite_path = SERVER_DIR / _sqlite_path
_sqlite_path = _sqlite_path.resolve()
_sqlite_path.parent.mkdir(parents=True, exist_ok=True)


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-only-change-me')
    SQLITE_DB_PATH = str(_sqlite_path)
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{_sqlite_path.as_posix()}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

