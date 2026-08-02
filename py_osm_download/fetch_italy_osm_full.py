#!/usr/bin/env python3
"""Download Italy, Sicily and Sardinia OSM power-grid data."""

from __future__ import annotations

from osm_grid_common import build_cli_parser, run_download, validate_args


DEFAULT_OUTPUT = "py_osm_download/output/italy_osm_power_grid_50kv_plus_full.geojson"


def main() -> int:
    parser = build_cli_parser("IT", DEFAULT_OUTPUT)
    args = parser.parse_args()
    validate_args(args)
    run_download(args, "IT", "Mainland Italy, Sicily and Sardinia")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
