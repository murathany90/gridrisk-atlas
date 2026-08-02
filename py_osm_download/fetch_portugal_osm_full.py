#!/usr/bin/env python3
"""Download mainland Portugal OSM power-grid data."""

from __future__ import annotations

from osm_grid_common import build_cli_parser, run_download, validate_args


DEFAULT_OUTPUT = "py_osm_download/output/portugal_osm_power_grid_50kv_plus_full.geojson"


def main() -> int:
    parser = build_cli_parser("PT", DEFAULT_OUTPUT)
    args = parser.parse_args()
    validate_args(args)
    run_download(args, "PT", "Mainland Portugal; Azores and Madeira excluded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
