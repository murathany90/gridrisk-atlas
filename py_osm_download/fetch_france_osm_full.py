#!/usr/bin/env python3
"""Download Metropolitan France and Corsica OSM power-grid data."""

from __future__ import annotations

from osm_grid_common import build_cli_parser, run_download, validate_args


DEFAULT_OUTPUT = "py_osm_download/output/france_osm_power_grid_50kv_plus_full.geojson"


def main() -> int:
    parser = build_cli_parser("FR", DEFAULT_OUTPUT)
    args = parser.parse_args()
    validate_args(args)
    run_download(args, "FR", "Metropolitan France and Corsica; overseas territories excluded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
