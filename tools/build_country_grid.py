#!/usr/bin/env python3
"""Validate raw OSM power exports and build compact country runtime datasets.

The Spain and France source files intentionally remain at the repository root as
import inputs.  Pages serves only the generated ``data/countries`` tree.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "data" / "countries"
BOUNDARY_SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_10m_admin_0_countries.geojson"
)

COUNTRIES = {
    "TR": {
        "nameTr": "Türkiye",
        "iso3": "TUR",
        "sources": [
            ROOT / "raw" / "TR" / "grid_400.geojson",
            ROOT / "raw" / "TR" / "grid_154.geojson",
            ROOT / "raw" / "TR" / "grid_33.geojson",
            ROOT / "raw" / "TR" / "substations.geojson",
        ],
        "expected": None,
        "partial": False,
        "failedRequests": 0,
    },
    "ES": {
        "nameTr": "İspanya",
        "iso3": "ESP",
        "sources": [ROOT / "spain_osm_power_grid_50kv_plus_full.geojson"],
        "expected": {"features": 19_116, "LineString": 15_264, "Point": 3_852},
        "partial": False,
        "failedRequests": 0,
    },
    "FR": {
        "nameTr": "Fransa",
        "iso3": "FRA",
        "sources": [ROOT / "france_osm_power_grid_50kv_plus_full.geojson"],
        "expected": {"features": 71_639, "LineString": 55_981, "Point": 15_658},
        "partial": True,
        "failedRequests": 14,
    },
}

LINE_POWER_TYPES = {"line", "minor_line", "cable"}
SUPPORTED_GEOMETRIES = {"Point", "LineString", "MultiLineString"}
DISPLAY_CLASS = {"400": "400 kV sınıfı", "154": "154 kV sınıfı"}


def _positive_numbers(value: Any) -> list[float]:
    if value is None or isinstance(value, bool):
        return []
    if isinstance(value, (list, tuple, set)):
        out: list[float] = []
        for item in value:
            out.extend(_positive_numbers(item))
        return out
    if isinstance(value, (int, float)):
        raw = float(value)
        return [raw / 1000 if raw > 10_000 else raw] if math.isfinite(raw) and raw > 0 else []
    out = []
    for token in re.split(r"[;,\s|/]+", str(value).strip()):
        if not token:
            continue
        try:
            raw = float(token)
        except ValueError:
            continue
        if math.isfinite(raw) and raw > 0:
            out.append(raw / 1000 if raw > 10_000 else raw)
    return out


def normalize_voltage_kv(properties: dict[str, Any]) -> float | None:
    """Return the maximum valid kV using the required source-field priority."""

    for key in ("voltageMaxKv", "voltagesKv", "voltageRaw", "voltage"):
        values = _positive_numbers(properties.get(key))
        if values:
            value = max(values)
            return int(value) if value.is_integer() else value
    return None


def voltage_class(actual_voltage_kv: float | None) -> str | None:
    if actual_voltage_kv is None:
        return None
    if 300 <= actual_voltage_kv <= 550:
        return "400"
    if 50 <= actual_voltage_kv < 300:
        return "154"
    return None


def _positions(coordinates: Any) -> Iterable[tuple[float, float]]:
    if (
        isinstance(coordinates, (list, tuple))
        and len(coordinates) >= 2
        and all(isinstance(value, (int, float)) for value in coordinates[:2])
    ):
        yield float(coordinates[0]), float(coordinates[1])
        return
    if isinstance(coordinates, (list, tuple)):
        for item in coordinates:
            yield from _positions(item)


def valid_geometry(geometry: Any) -> bool:
    if not isinstance(geometry, dict) or geometry.get("type") not in SUPPORTED_GEOMETRIES:
        return False
    coordinates = geometry.get("coordinates")
    positions = list(_positions(coordinates))
    if not positions:
        return False
    if geometry["type"] in {"LineString", "MultiLineString"} and len(positions) < 2:
        return False
    return all(
        math.isfinite(lon)
        and math.isfinite(lat)
        and -180 <= lon <= 180
        and -90 <= lat <= 90
        for lon, lat in positions
    )


def normalize_line_geometries(geometry: dict[str, Any]) -> list[dict[str, Any]]:
    """Return runtime LineStrings, splitting a supported MultiLineString into parts."""

    if geometry.get("type") == "MultiLineString":
        return [
            {"type": "LineString", "coordinates": coordinates}
            for coordinates in geometry.get("coordinates", [])
        ]
    return [geometry]


def _source_id(properties: dict[str, Any], fallback_index: int) -> str:
    for key in ("osm_id", "osm_id2", "osmId", "id", "OBJECTID"):
        value = properties.get(key)
        if value not in (None, ""):
            text = re.sub(r"[^A-Za-z0-9_.:-]+", "-", str(value).strip())
            if text:
                return text
    return f"source-{fallback_index}"


def _runtime_properties(
    country_code: str,
    properties: dict[str, Any],
    asset_type: str,
    actual_voltage_kv: float | None,
    grid_class: str | None,
    source_id: str,
) -> dict[str, Any]:
    power_type = str(properties.get("power") or properties.get("elementType") or "").lower()
    result: dict[str, Any] = {
        "assetId": f"{country_code}-{asset_type}-{source_id}",
        "countryCode": country_code,
        "assetType": asset_type,
        "actualVoltageKv": actual_voltage_kv,
        "gridClass": grid_class,
        "name": properties.get("name") or None,
        "operator": properties.get("operator") or None,
        "osmId": properties.get("osm_id")
        or properties.get("osm_id2")
        or properties.get("osmId")
        or None,
        "source": "OpenStreetMap",
        "sourceLicense": "ODbL 1.0",
    }
    if asset_type == "line":
        result.update(
            {
                "displayClass": DISPLAY_CLASS[grid_class],
                "voltageRaw": properties.get("voltageRaw", properties.get("voltage")),
                "powerType": power_type,
            }
        )
    return result


def _empty_collection(country_code: str, layer: str) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "metadata": {
            "countryCode": country_code,
            "layer": layer,
            "source": "OpenStreetMap",
            "license": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors",
        },
        "features": [],
    }


def _load_sources(country_code: str, config: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    features: list[dict[str, Any]] = []
    metadata: dict[str, Any] = {}
    for path in config["sources"]:
        if not path.exists():
            raise FileNotFoundError(f"Missing raw source: {path.relative_to(ROOT)}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
            raise ValueError(f"Invalid FeatureCollection: {path.relative_to(ROOT)}")
        source_features = data["features"]
        if country_code == "TR" and path.stem == "substations":
            source_features = [
                {
                    **feature,
                    "properties": {"power": "substation", **(feature.get("properties") or {})},
                }
                for feature in source_features
            ]
        features.extend(source_features)
        metadata.update(data.get("metadata") or {})
    if country_code in {"ES", "FR"}:
        actual_code = (metadata.get("filters") or {}).get("countryCode")
        if actual_code != country_code:
            raise ValueError(f"{country_code}: raw metadata countryCode is {actual_code!r}")
    return features, metadata


def _validate_expected(country_code: str, features: list[dict[str, Any]], config: dict[str, Any]) -> None:
    expected = config.get("expected")
    if not expected:
        return
    geometries = Counter((feature.get("geometry") or {}).get("type") for feature in features)
    actual = {"features": len(features), "LineString": geometries["LineString"], "Point": geometries["Point"]}
    if actual != expected:
        raise ValueError(f"{country_code}: raw count mismatch; expected={expected}, actual={actual}")


def _natural_earth() -> dict[str, Any]:
    with urllib.request.urlopen(BOUNDARY_SOURCE_URL, timeout=60) as response:
        return json.load(response)


def _select_boundary(country_code: str, iso3: str, source: dict[str, Any]) -> dict[str, Any]:
    match = next(
        (f for f in source.get("features", []) if (f.get("properties") or {}).get("ADM0_A3") == iso3),
        None,
    )
    if not match:
        raise ValueError(f"Natural Earth boundary missing for {country_code}/{iso3}")
    geometry = match["geometry"]
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]

    def keep(polygon: list[Any]) -> bool:
        outer = polygon[0]
        xs = [position[0] for position in outer]
        ys = [position[1] for position in outer]
        if country_code == "ES":
            # Mainland, adjacent coastal islands and Balearics; Canaries and north-African enclaves excluded.
            return max(ys) >= 36 and min(xs) >= -10.5 and max(xs) <= 5.5
        if country_code == "FR":
            # Metropolitan France, Corsica and adjacent metropolitan islands only.
            return min(ys) >= 41 and max(ys) <= 52 and min(xs) >= -6 and max(xs) <= 10
        return True

    selected = [polygon for polygon in polygons if keep(polygon)]
    if not selected:
        raise ValueError(f"Boundary filter removed every polygon for {country_code}")
    return {"type": "MultiPolygon", "coordinates": selected}


def _bounds_from_geometry(geometry: dict[str, Any]) -> list[float]:
    positions = list(_positions(geometry.get("coordinates")))
    return [
        round(min(lon for lon, _ in positions), 6),
        round(min(lat for _, lat in positions), 6),
        round(max(lon for lon, _ in positions), 6),
        round(max(lat for _, lat in positions), 6),
    ]


def build_country(country_code: str, boundary_source: dict[str, Any]) -> dict[str, Any]:
    config = COUNTRIES[country_code]
    raw_features, raw_metadata = _load_sources(country_code, config)
    _validate_expected(country_code, raw_features, config)

    outputs = {
        "400": _empty_collection(country_code, "400"),
        "154": _empty_collection(country_code, "154"),
        "substations": _empty_collection(country_code, "substations"),
    }
    counts = Counter()
    seen_assets: set[str] = set()

    for index, feature in enumerate(raw_features, start=1):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        raw_country = properties.get("countryCode") or (raw_metadata.get("filters") or {}).get("countryCode")
        if raw_country and raw_country != country_code:
            counts["countryCodeMismatchCount"] += 1
            continue
        if not valid_geometry(geometry):
            counts["invalidGeometryCount"] += 1
            continue
        power_type = str(properties.get("power") or properties.get("elementType") or "").lower()
        geom_type = geometry["type"]
        is_line = power_type in LINE_POWER_TYPES and geom_type in {"LineString", "MultiLineString"}
        is_substation = power_type == "substation" and geom_type == "Point"
        if not (is_line or is_substation):
            counts["unsupportedFeatureCount"] += 1
            continue

        actual_voltage_kv = normalize_voltage_kv(properties)
        grid_class = voltage_class(actual_voltage_kv)
        if actual_voltage_kv is not None and actual_voltage_kv < 50:
            counts["excludedBelow50Count"] += 1
            continue
        if actual_voltage_kv is not None and actual_voltage_kv > 550:
            counts["excludedAbove550Count"] += 1
            continue
        if is_line and grid_class is None:
            counts["excludedUnclassifiedCount"] += 1
            continue
        if is_substation and grid_class is None and country_code != "TR":
            counts["excludedUnclassifiedCount"] += 1
            continue

        source_id = _source_id(properties, index)
        asset_type = "line" if is_line else "substation"
        if is_line:
            # OSM/ArcGIS exports can reuse the same numeric identifier for a line
            # and a cable record; power type keeps the runtime identity stable.
            source_id = f"{power_type}-{source_id}"
        line_geometries = normalize_line_geometries(geometry)
        if geom_type == "MultiLineString":
            counts["normalizedMultiLineCount"] += 1

        for part_index, normalized_geometry in enumerate(line_geometries, start=1):
            part_source_id = source_id if len(line_geometries) == 1 else f"{source_id}-part-{part_index}"
            runtime_properties = _runtime_properties(
                country_code, properties, asset_type, actual_voltage_kv, grid_class, part_source_id
            )
            asset_id = runtime_properties["assetId"]
            if asset_id in seen_assets:
                counts["duplicateAssetCount"] += 1
                continue
            seen_assets.add(asset_id)
            target = grid_class if is_line else "substations"
            outputs[target]["features"].append(
                {"type": "Feature", "properties": runtime_properties, "geometry": normalized_geometry}
            )

    if counts["countryCodeMismatchCount"]:
        raise ValueError(f"{country_code}: {counts['countryCodeMismatchCount']} countryCode mismatches")
    if counts["duplicateAssetCount"]:
        raise ValueError(f"{country_code}: {counts['duplicateAssetCount']} duplicate runtime asset IDs")

    boundary_geometry = _select_boundary(country_code, config["iso3"], boundary_source)
    bounds = _bounds_from_geometry(boundary_geometry)
    country_dir = OUTPUT_ROOT / country_code
    country_dir.mkdir(parents=True, exist_ok=True)
    boundary = {
        "type": "FeatureCollection",
        "metadata": {
            "countryCode": country_code,
            "source": "Natural Earth 1:10m Admin 0 Countries",
            "sourceUrl": BOUNDARY_SOURCE_URL,
            "license": "Public domain",
        },
        "features": [
            {
                "type": "Feature",
                "properties": {"countryCode": country_code, "nameTr": config["nameTr"]},
                "geometry": boundary_geometry,
            }
        ],
    }

    partial = bool((raw_metadata.get("downloadDiagnostics") or {}).get("partial", config["partial"]))
    failed_requests = int(
        (raw_metadata.get("downloadDiagnostics") or {}).get("failedRequests", config["failedRequests"])
    )
    manifest = {
        "countryCode": country_code,
        "countryNameTr": config["nameTr"],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "OpenStreetMap",
        "license": "ODbL 1.0",
        "minimumVoltageKv": 50,
        "maximumIncludedVoltageKv": 550,
        "classification": {"400": "300-550 kV", "154": "50-299.999 kV"},
        "rawFeatureCount": len(raw_features),
        "grid400Count": len(outputs["400"]["features"]),
        "grid154Count": len(outputs["154"]["features"]),
        "substationCount": len(outputs["substations"]["features"]),
        "excludedBelow50Count": counts["excludedBelow50Count"],
        "excludedAbove550Count": counts["excludedAbove550Count"],
        "excludedUnclassifiedCount": counts["excludedUnclassifiedCount"],
        "invalidGeometryCount": counts["invalidGeometryCount"],
        "unsupportedFeatureCount": counts["unsupportedFeatureCount"],
        "duplicateAssetCount": counts["duplicateAssetCount"],
        "normalizedMultiLineCount": counts["normalizedMultiLineCount"],
        "partial": partial,
        "failedRequests": failed_requests,
        "bounds": bounds,
    }

    payloads = {
        "boundary.geojson": boundary,
        "grid_400.geojson": outputs["400"],
        "grid_154.geojson": outputs["154"],
        "substations.geojson": outputs["substations"],
        "manifest.json": manifest,
    }
    for filename, payload in payloads.items():
        (country_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    return manifest


def validate_runtime(country_code: str) -> dict[str, Any]:
    country_dir = OUTPUT_ROOT / country_code
    manifest = json.loads((country_dir / "manifest.json").read_text(encoding="utf-8"))
    seen: set[str] = set()
    counts = {}
    for filename in ("grid_400.geojson", "grid_154.geojson", "substations.geojson"):
        data = json.loads((country_dir / filename).read_text(encoding="utf-8"))
        counts[filename] = len(data["features"])
        for feature in data["features"]:
            if not valid_geometry(feature.get("geometry")):
                raise ValueError(f"{country_code}/{filename}: invalid runtime geometry")
            properties = feature.get("properties") or {}
            if properties.get("countryCode") != country_code:
                raise ValueError(f"{country_code}/{filename}: countryCode leakage")
            asset_id = properties.get("assetId")
            if not asset_id or not asset_id.startswith(f"{country_code}-") or asset_id in seen:
                raise ValueError(f"{country_code}/{filename}: invalid or duplicate assetId {asset_id!r}")
            seen.add(asset_id)
            if any(key in properties for key in ("tags", "OBJECTID", "osm_id", "osm_id2")):
                raise ValueError(f"{country_code}/{filename}: raw-only property leaked")
    if counts["grid_400.geojson"] != manifest["grid400Count"]:
        raise ValueError(f"{country_code}: grid400 manifest mismatch")
    if counts["grid_154.geojson"] != manifest["grid154Count"]:
        raise ValueError(f"{country_code}: grid154 manifest mismatch")
    if counts["substations.geojson"] != manifest["substationCount"]:
        raise ValueError(f"{country_code}: substation manifest mismatch")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", choices=["TR", "ES", "FR", "ALL"], default="ALL")
    parser.add_argument("--validate-runtime", action="store_true")
    args = parser.parse_args()
    country_codes = list(COUNTRIES) if args.country == "ALL" else [args.country]
    if args.validate_runtime:
        manifests = [validate_runtime(code) for code in country_codes]
    else:
        boundary_source = _natural_earth()
        manifests = [build_country(code, boundary_source) for code in country_codes]
        manifests = [validate_runtime(code) for code in country_codes]
    for manifest in manifests:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
