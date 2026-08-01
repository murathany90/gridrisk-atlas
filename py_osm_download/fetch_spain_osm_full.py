#!/usr/bin/env python3
"""Download mainland Spain and Balearic OSM power-grid data."""

from __future__ import annotations

from osm_grid_common import build_cli_parser, run_download, validate_args


DEFAULT_OUTPUT = "py_osm_download/output/spain_osm_power_grid_50kv_plus_full.geojson"


def main() -> int:
    parser = build_cli_parser("ES", DEFAULT_OUTPUT)
    parser.add_argument(
        "--include-canary",
        action="store_true",
        help="Reserved for a boundary file that explicitly includes the Canaries; the application boundary excludes them.",
    )
    args = parser.parse_args()
    validate_args(args)
    if args.include_canary:
        parser.error("--include-canary requires a Canary-inclusive boundary and is not valid for the production ES boundary")
    run_download(args, "ES", "Mainland Spain and Balearic Islands; Canary Islands excluded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
