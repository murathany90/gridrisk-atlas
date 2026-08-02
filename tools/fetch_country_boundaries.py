#!/usr/bin/env python3
"""Fetch production PT/IT boundaries from the official Eurostat/GISCO API."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests
from shapely.geometry import MultiPolygon, mapping, shape


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = (
    "https://gisco-services.ec.europa.eu/distribution/v2/countries/geojson/"
    "CNTR_RG_01M_2024_4326.geojson"
)
COUNTRIES = {
    "PT": {
        "nameTr": "Portekiz",
        "coverage": "Portekiz ana karası; Azorlar ve Madeira kapsam dışıdır",
    },
    "IT": {
        "nameTr": "İtalya",
        "coverage": "İtalya ana karası, Sicilya ve Sardinya",
    },
}


def _portugal_mainland(geometry):
    parts = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
    # Mainland Portugal and its immediately adjacent national islands lie east
    # of 10.5°W.  Madeira and the Azores are intentionally outside v3.6.0.
    kept = [part for part in parts if part.bounds[0] > -10.5 and part.bounds[1] > 35.5]
    if not kept:
        raise ValueError("GISCO PT geometry has no mainland component")
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def build_boundaries(payload: dict, output_root: Path) -> list[Path]:
    by_code = {
        str(feature.get("properties", {}).get("CNTR_ID")): feature
        for feature in payload.get("features") or []
    }
    written = []
    for code, config in COUNTRIES.items():
        source_feature = by_code.get(code)
        if source_feature is None:
            raise ValueError(f"GISCO response does not contain {code}")
        geometry = shape(source_feature["geometry"])
        if code == "PT":
            geometry = _portugal_mainland(geometry)
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"Invalid {code} boundary geometry")
        collection = {
            "type": "FeatureCollection",
            "metadata": {
                "countryCode": code,
                "countryNameTr": config["nameTr"],
                "coverage": config["coverage"],
                "source": "European Commission, Eurostat/GISCO — Countries 2024",
                "sourceUrl": SOURCE_URL,
                "scale": "1:1 million",
                "crs": "EPSG:4326",
                "copyright": "© EuroGeographics for the administrative boundaries",
            },
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "countryCode": code,
                        "countryNameTr": config["nameTr"],
                        "coverage": config["coverage"],
                        "source": "Eurostat/GISCO Countries 2024",
                        "copyright": "© EuroGeographics for the administrative boundaries",
                    },
                    "geometry": mapping(geometry),
                }
            ],
        }
        target = output_root / code / "boundary.geojson"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(collection, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
            encoding="utf-8",
        )
        written.append(target)
    return written


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", default=SOURCE_URL)
    parser.add_argument("--output-root", default=str(ROOT / "data" / "countries"))
    args = parser.parse_args()
    response = requests.get(
        args.source_url,
        headers={"User-Agent": "GridMoni/3.6.2"},
        timeout=120,
    )
    response.raise_for_status()
    for path in build_boundaries(response.json(), Path(args.output_root)):
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
