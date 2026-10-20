"""Regulator sources. Each module exposes SOURCE_ID and fetch_listing(http).

To add a regulator (SEC Nigeria, NDPC, FCA, ...), write a module with the same
two members and register it in SOURCES.
"""
from . import cbn

SOURCES = {
    cbn.SOURCE_ID: cbn,
}
