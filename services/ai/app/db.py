"""PostgreSQL connection pool for the AI service, plus two small query helpers.
Rows come back as dicts (column name -> value).
"""
from __future__ import annotations

from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# check_connection tests each connection before handing it out, so a connection the database
# closed while idle (Neon pauses after 5 minutes) is replaced instead of failing the request.
pool = ConnectionPool(settings.database_url, min_size=1, max_size=10, open=False, max_idle=120,
                      check=ConnectionPool.check_connection,
                      kwargs={"row_factory": dict_row, "autocommit": False})


@contextmanager
def conn():
    with pool.connection() as c:
        yield c


def fetchall(sql: str, params=None) -> list[dict]:
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def fetchone(sql: str, params=None) -> dict | None:
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchone()
