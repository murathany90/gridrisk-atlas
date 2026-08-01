#!/usr/bin/env python3
"""Build compact, boundary-safe TR/ES/FR runtime grid datasets."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from shapely.geometry import GeometryCollection, LineString, MultiLineString, mapping, shape


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_osm_download"))

from osm_grid_common import (  # noqa: E402
    ATTRIBUTION,
    LICENSE,
    LINE_TYPES,
    atomic_json_write,
    choose_preferred_feature,
    feature_key,
    load_boundary,
    normalized_osm_type,
    normalize_osm_id,
    parse_feature_voltages_kv,
    valid_geojson_geometry,
    voltage_class,
)


OUTPUT_ROOT = ROOT / "data" / "countries"
DISPLAY_CLASS = {"400": "400 kV sınıfı", "154": "154 kV sınıfı"}
COUNTRIES = {
    "TR": {
        "nameTr": "Türkiye",
        "coverage": "Türkiye",
        "sources": [
            ROOT / "raw" / "TR" / "grid_400.geojson",
            ROOT / "raw" / "TR" / "grid_154.geojson",
            ROOT / "raw" / "TR" / "grid_33.geojson",
            ROOT / "raw" / "TR" / "substations.geojson",
        ],
    },
    "ES": {
        "nameTr": "İspanya",
        "coverage": "İspanya ana karası ve Balear Adaları; Kanarya Adaları kapsam dışıdır",
        "sources": [ROOT / "spain_osm_power_grid_50kv_plus_full.geojson"],
    },
    "FR": {
        "nameTr": "Fransa",
        "coverage": "Metropolitan Fransa ve Korsika; denizaşırı bölgeler kapsam dışıdır",
        "sources": [ROOT / "france_osm_power_grid_50kv_plus_full.geojson"],
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_voltage_kv(properties: dict[str, Any]) -> float | None:
    values = parse_feature_voltages_kv(properties)
    value = max(values) if values else None
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


def valid_geometry(geometry: Any) -> bool:
    return valid_geojson_geometry(geometry)


def normalize_line_geometries(geometry: dict[str, Any]) -> list[dict[str, Any]]:
    candidate = shape(geometry)
    if candidate.geom_type == "LineString":
        return [mapping(candidate)]
    if candidate.geom_type == "MultiLineString":
        return [mapping(part) for part in candidate.geoms if not part.is_empty and part.length > 0]
    return []


def _extract_lines(candidate) -> list[LineString]:
    if candidate.is_empty:
        return []
    if candidate.geom_type == "LineString":
        return [candidate] if candidate.length > 0 else []
    if candidate.geom_type == "MultiLineString":
        return [line for line in candidate.geoms if not line.is_empty and line.length > 0]
    if candidate.geom_type == "GeometryCollection":
        return [line for part in candidate.geoms for line in _extract_lines(part)]
    return []


def _clip_line(geometry: dict[str, Any], boundary) -> tuple[list[dict[str, Any]], bool]:
    candidate = shape(geometry)
    if not candidate.intersects(boundary):
        return [], False
    clipped = candidate.intersection(boundary)
    lines = _extract_lines(clipped)
    return [mapping(line) for line in lines], not clipped.equals(candidate)


def _substation_point(geometry: dict[str, Any], boundary) -> tuple[dict[str, Any] | None, bool]:
    candidate = shape(geometry)
    if not candidate.intersects(boundary):
        return None, False
    if candidate.geom_type == "Point":
        return (mapping(candidate), False) if boundary.covers(candidate) else (None, False)
    clipped = candidate.intersection(boundary)
    if clipped.is_empty:
        return None, False
    point = clipped.representative_point()
    return mapping(point), True


def _bounds(boundary) -> list[float]:
    return [round(value, 6) for value in boundary.bounds]


def _load_boundary_collection(country_code: str) -> tuple[dict[str, Any], Any]:
    path = OUTPUT_ROOT / country_code / "boundary.geojson"
    data = json.loads(path.read_text(encoding="utf-8"))
    return data, load_boundary(path)


def _load_sources(country_code: str, config: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    features: list[dict[str, Any]] = []
    combined_metadata: dict[str, Any] = {}
    providers: list[str] = []
    for path in config["sources"]:
        if not path.exists():
            raise FileNotFoundError(f"Missing raw source: {path.relative_to(ROOT)}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
            raise ValueError(f"Invalid FeatureCollection: {path.relative_to(ROOT)}")
        metadata = data.get("metadata") or {}
        if country_code in {"ES", "FR"}:
            actual = (metadata.get("filters") or {}).get("countryCode")
            if actual != country_code:
                raise ValueError(f"{country_code}: raw metadata countryCode is {actual!r}")
        source_features = data["features"]
        if country_code == "TR" and path.stem == "substations":
            source_features = [
                {**feature, "properties": {"power": "substation", **(feature.get("properties") or {})}}
                for feature in source_features
            ]
        features.extend(source_features)
        combined_metadata.update(metadata)
        for provider in metadata.get("sourceProviders") or [metadata.get("source")]:
            if provider and provider not in providers:
                providers.append(provider)
    combined_metadata["sourceProviders"] = providers
    return features, combined_metadata


def _clean_text(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text or None


def _format_voltage(value: float | int | None) -> str:
    if value is None:
        return "Bilinmeyen gerilim"
    return f"{float(value):g} kV"


def _display_label(properties: dict[str, Any], actual_voltage: float | int | None, osm_id: str | None) -> tuple[str, str]:
    name = _clean_text(properties.get("name"))
    ref = _clean_text(properties.get("ref"))
    from_name = _clean_text(properties.get("from"))
    to_name = _clean_text(properties.get("to"))
    operator = _clean_text(properties.get("operator"))
    if name:
        return name, "osm-name"
    if ref:
        return ref, "osm-ref"
    if from_name and to_name:
        return f"{from_name} – {to_name}", "osm-from-to"
    suffix = f"OSM {osm_id}" if osm_id else "OSM kimliği yok"
    voltage = _format_voltage(actual_voltage)
    if operator:
        return f"{operator} · {voltage} · {suffix}", "generated-identifier"
    return f"{voltage} · {suffix}", "generated-identifier"


def _runtime_properties(
    country_code: str,
    properties: dict[str, Any],
    *,
    asset_type: str,
    power_type: str,
    actual_voltages: list[float],
    grid_class: str | None,
    osm_type: str,
    osm_id: str | None,
    asset_suffix: str,
) -> dict[str, Any]:
    actual = max(actual_voltages) if actual_voltages else None
    display_label, label_source = _display_label(properties, actual, osm_id)
    result = {
        "assetId": f"{country_code}-{asset_type}-{osm_type}-{asset_suffix}",
        "countryCode": country_code,
        "assetType": asset_type,
        "powerType": power_type,
        "osmType": osm_type,
        "osmId": osm_id,
        "actualVoltagesKv": [int(value) if float(value).is_integer() else value for value in actual_voltages],
        "actualVoltageKv": int(actual) if actual is not None and float(actual).is_integer() else actual,
        "gridClass": grid_class,
        "displayClass": DISPLAY_CLASS.get(grid_class),
        "name": _clean_text(properties.get("name")),
        "ref": _clean_text(properties.get("ref")),
        "operator": _clean_text(properties.get("operator")),
        "from": _clean_text(properties.get("from")),
        "to": _clean_text(properties.get("to")),
        "displayLabel": display_label,
        "labelSource": label_source,
        "voltageRaw": properties.get("voltage") if properties.get("voltage") not in (None, "") else properties.get("voltageRaw"),
        "circuits": _clean_text(properties.get("circuits")),
        "cables": _clean_text(properties.get("cables")),
        "frequency": _clean_text(properties.get("frequency")),
        "location": _clean_text(properties.get("location")),
        "sourceProvider": _clean_text(properties.get("sourceProvider")) or "OpenStreetMap",
        "sourceFallback": properties.get("sourceFallback"),
        "sourceLicense": LICENSE,
        "osmTimestamp": _clean_text(properties.get("osm_timestamp")) or _clean_text(properties.get("osmTimestamp")),
    }
    return result


def _empty_collection(country_code: str, layer: str, providers: list[str]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "metadata": {
            "countryCode": country_code,
            "layer": layer,
            "sourceProviders": providers,
            "license": LICENSE,
            "attribution": ATTRIBUTION,
        },
        "features": [],
    }


def _download_state(metadata: dict[str, Any]) -> tuple[bool, int, list[Any]]:
    diagnostics = metadata.get("downloadDiagnostics") or {}
    partial = bool(diagnostics.get("partial", metadata.get("partial", False)))
    failed_requests = int(diagnostics.get("failedRequests", metadata.get("failedRequests", 0)) or 0)
    failed_tiles = diagnostics.get("failedTiles", metadata.get("failedTiles", [])) or []
    return partial, failed_requests, failed_tiles


def build_country(country_code: str, _boundary_source: dict[str, Any] | None = None) -> dict[str, Any]:
    config = COUNTRIES[country_code]
    boundary_collection, boundary = _load_boundary_collection(country_code)
    raw_features, raw_metadata = _load_sources(country_code, config)
    providers = [str(value) for value in raw_metadata.get("sourceProviders") or ["OpenStreetMap"]]
    outputs = {
        "400": _empty_collection(country_code, "400", providers),
        "154": _empty_collection(country_code, "154", providers),
        "substations": _empty_collection(country_code, "substations", providers),
    }
    counts = Counter()
    source_contribution = Counter()
    seen_assets: set[str] = set()
    unique_raw: dict[str, dict[str, Any]] = {}

    for feature in raw_features:
        if not valid_geometry(feature.get("geometry")):
            counts["invalidGeometryCount"] += 1
            continue
        key = feature_key(country_code, feature)
        if key in unique_raw:
            counts["duplicateCount"] += 1
            unique_raw[key] = choose_preferred_feature(unique_raw[key], feature)
        else:
            unique_raw[key] = feature

    for fallback_index, feature in enumerate(unique_raw.values(), start=1):
        properties = feature.get("properties") or {}
        geometry = feature["geometry"]
        raw_country = properties.get("countryCode") or (raw_metadata.get("filters") or {}).get("countryCode")
        if raw_country and raw_country != country_code:
            counts["countryCodeMismatchCount"] += 1
            continue
        power_type = str(properties.get("power") or properties.get("elementType") or "").strip().lower()
        is_line = power_type in LINE_TYPES and geometry["type"] in {"LineString", "MultiLineString"}
        is_substation = power_type == "substation" and geometry["type"] in {"Point", "Polygon", "MultiPolygon"}
        if not (is_line or is_substation):
            counts["unsupportedFeatureCount"] += 1
            continue
        actual_voltages = parse_feature_voltages_kv(properties)
        actual = max(actual_voltages) if actual_voltages else None
        grid_class = voltage_class(actual)
        if actual is not None and actual < 50:
            counts["excludedBelow50Count"] += 1
            continue
        if actual is not None and actual > 550:
            counts["excludedAbove550Count"] += 1
            continue
        if is_line and grid_class is None:
            counts["excludedUnclassifiedCount"] += 1
            continue
        if is_substation and grid_class is None and country_code != "TR":
            counts["excludedUnclassifiedCount"] += 1
            continue

        if is_line:
            runtime_geometries, clipped = _clip_line(geometry, boundary)
            if not runtime_geometries:
                counts["outsideBoundaryCount"] += 1
                continue
            if clipped:
                counts["boundaryClippedLineCount"] += 1
        else:
            runtime_point, converted = _substation_point(geometry, boundary)
            if runtime_point is None:
                counts["outsideBoundaryCount"] += 1
                continue
            runtime_geometries = [runtime_point]
            if converted:
                counts["representativePointCount"] += 1

        osm_id = normalize_osm_id(properties)
        osm_type = normalized_osm_type(power_type, geometry["type"], properties)
        base_suffix = re.sub(r"[^A-Za-z0-9_.:-]+", "-", osm_id or f"geometry-{fallback_index}")
        asset_type = "line" if is_line else "substation"
        for part_index, runtime_geometry in enumerate(runtime_geometries, start=1):
            suffix = base_suffix if len(runtime_geometries) == 1 else f"{base_suffix}-part-{part_index}"
            runtime_properties = _runtime_properties(
                country_code,
                properties,
                asset_type=asset_type,
                power_type=power_type,
                actual_voltages=actual_voltages,
                grid_class=grid_class,
                osm_type=osm_type,
                osm_id=osm_id,
                asset_suffix=suffix,
            )
            asset_id = runtime_properties["assetId"]
            if asset_id in seen_assets:
                counts["duplicateAssetCount"] += 1
                continue
            seen_assets.add(asset_id)
            target = grid_class if is_line else "substations"
            outputs[target]["features"].append(
                {"type": "Feature", "properties": runtime_properties, "geometry": runtime_geometry}
            )
            provider = runtime_properties["sourceProvider"]
            source_contribution[provider] += 1
            if is_line:
                counts["validLineCount"] += 1
                counts[f"grid{grid_class}Count"] += 1
                counts["namedLineCount"] += bool(runtime_properties["name"])
                counts["referencedLineCount"] += bool(runtime_properties["ref"])
                counts["operatorLineCount"] += bool(runtime_properties["operator"])
            else:
                counts["validSubstationCount"] += 1

    if counts["countryCodeMismatchCount"]:
        raise ValueError(f"{country_code}: {counts['countryCodeMismatchCount']} countryCode mismatches")
    if counts["duplicateAssetCount"]:
        raise ValueError(f"{country_code}: {counts['duplicateAssetCount']} duplicate runtime asset IDs")

    partial, failed_requests, failed_tiles = _download_state(raw_metadata)
    diagnostics = raw_metadata.get("downloadDiagnostics") or {}
    manifest = {
        "countryCode": country_code,
        "countryNameTr": config["nameTr"],
        "generatedAt": utc_now(),
        "downloadedAt": raw_metadata.get("downloadedAt") or raw_metadata.get("exportedAt"),
        "sourceProviders": providers,
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "minimumVoltageKv": 50,
        "maximumIncludedVoltageKv": 550,
        "classification": {"400": "300-550 kV", "154": "50-299.999 kV"},
        "partial": partial,
        "failedRequests": failed_requests,
        "failedTiles": failed_tiles,
        "rawFeatureCount": len(raw_features),
        "validLineCount": counts["validLineCount"],
        "validSubstationCount": counts["validSubstationCount"],
        "grid400Count": len(outputs["400"]["features"]),
        "grid154Count": len(outputs["154"]["features"]),
        "substationCount": len(outputs["substations"]["features"]),
        "excludedBelow50Count": counts["excludedBelow50Count"],
        "excludedAbove550Count": counts["excludedAbove550Count"],
        "excludedUnclassifiedCount": counts["excludedUnclassifiedCount"],
        "outsideBoundaryCount": counts["outsideBoundaryCount"],
        "invalidGeometryCount": counts["invalidGeometryCount"],
        "unsupportedFeatureCount": counts["unsupportedFeatureCount"],
        "duplicateCount": counts["duplicateCount"],
        "duplicateAssetCount": counts["duplicateAssetCount"],
        "boundaryClippedLineCount": counts["boundaryClippedLineCount"],
        "representativePointCount": counts["representativePointCount"],
        "namedLineCount": counts["namedLineCount"],
        "referencedLineCount": counts["referencedLineCount"],
        "operatorLineCount": counts["operatorLineCount"],
        "sourceContribution": dict(sorted(source_contribution.items())),
        "suspectedGapTileCount": int(diagnostics.get("suspectedGapTileCount") or 0),
        "coverage": config["coverage"],
        "bounds": _bounds(boundary),
    }
    payloads = {
        "boundary.geojson": boundary_collection,
        "grid_400.geojson": outputs["400"],
        "grid_154.geojson": outputs["154"],
        "substations.geojson": outputs["substations"],
        "manifest.json": manifest,
    }
    country_dir = OUTPUT_ROOT / country_code
    for filename, payload in payloads.items():
        atomic_json_write(country_dir / filename, payload)
    return manifest


def validate_runtime(country_code: str) -> dict[str, Any]:
    country_dir = OUTPUT_ROOT / country_code
    boundary = load_boundary(country_dir / "boundary.geojson")
    manifest = json.loads((country_dir / "manifest.json").read_text(encoding="utf-8"))
    seen: set[str] = set()
    counts: dict[str, int] = {}
    for filename in ("grid_400.geojson", "grid_154.geojson", "substations.geojson"):
        data = json.loads((country_dir / filename).read_text(encoding="utf-8"))
        counts[filename] = len(data["features"])
        for feature in data["features"]:
            if country_code in {"ES", "FR"} and not valid_geometry(feature.get("geometry")):
                raise ValueError(f"{country_code}/{filename}: invalid runtime geometry")
            if country_code in {"ES", "FR"} and not shape(feature["geometry"]).intersects(boundary):
                raise ValueError(f"{country_code}/{filename}: geometry outside boundary")
            properties = feature.get("properties") or {}
            if properties.get("countryCode") != country_code:
                raise ValueError(f"{country_code}/{filename}: countryCode leakage")
            asset_id = properties.get("assetId")
            if not asset_id or not asset_id.startswith(f"{country_code}-") or asset_id in seen:
                raise ValueError(f"{country_code}/{filename}: invalid or duplicate assetId {asset_id!r}")
            seen.add(asset_id)
            if any(key in properties for key in ("tags", "OBJECTID", "osm_id", "osm_id2")):
                raise ValueError(f"{country_code}/{filename}: raw-only property leaked")
            if filename != "substations.geojson":
                actual = properties.get("actualVoltageKv")
                if voltage_class(actual) != properties.get("gridClass"):
                    raise ValueError(f"{country_code}/{filename}: invalid voltage class")
                if country_code in {"ES", "FR"} and (not properties.get("displayLabel") or not properties.get("labelSource")):
                    raise ValueError(f"{country_code}/{filename}: missing display label")
    expected = {
        "grid_400.geojson": manifest["grid400Count"],
        "grid_154.geojson": manifest["grid154Count"],
        "substations.geojson": manifest["substationCount"],
    }
    if counts != expected:
        raise ValueError(f"{country_code}: runtime counts do not match manifest: {counts} != {expected}")
    if country_code in {"ES", "FR"} and (manifest["partial"] or manifest["failedRequests"]):
        raise ValueError(f"{country_code}: production runtime cannot be partial")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", choices=["TR", "ES", "FR", "ESFR", "ALL"], default="ESFR")
    parser.add_argument("--validate-runtime", action="store_true")
    args = parser.parse_args()
    country_codes = list(COUNTRIES) if args.country == "ALL" else ["ES", "FR"] if args.country == "ESFR" else [args.country]
    manifests = [validate_runtime(code) for code in country_codes] if args.validate_runtime else [build_country(code) for code in country_codes]
    if not args.validate_runtime:
        manifests = [validate_runtime(code) for code in country_codes]
    for manifest in manifests:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
