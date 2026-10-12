"""Connexion base de données.

Par défaut : SQLite (zéro installation, fichier `savora.db`).
Pour PostgreSQL : DATABASE_URL=postgresql+psycopg://user:pass@host/savora
"""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DEFAULT_URL = f"sqlite:///{Path(__file__).resolve().parents[1] / 'savora.db'}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_URL)

_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
