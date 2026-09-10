#!/usr/bin/env python3
"""Build GridRisk's own persistent-thermal-source GeoJSON from offline history.

This tool deliberately does not download FIRMS data or OSM during browser use.
Feed it a reviewed, canonical historical export (CSV) and, optionally, a real
OSM GeoJSON extract.  The resulting file is safe to publish with the runtime
dataset and is the only input used by static-source suppression.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


def value(row: dict[str, Any], *names: str) -> str | None:
    for name in names:
        candidate = row.get(name)
        if candidate not in (None, ""):
            return str(candidate).strip()
    return None


def float_value(row: dict[str, Any], *names: str) -> float | None:
    raw = value(row, *names)
    try:
        return float(raw) if raw is not None else None
    except ValueError:
        return None


def parse_time(row: dict[str, Any]) -> datetime | None:
    raw = value(row, "detectedAt", "acq_datetime", "datetime", "time", "acq_date")
    if not raw:
        return None
    if "T" not in raw and len(raw) == 10:
        raw = f"{raw}T{(value(row, 'acq_time') or '0000').zfill(4)[:2]}:{(value(row, 'acq_time') or '0000').zfill(4)[2:]}:00"
    raw = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def quantile(rows: list[float], percentile: float) -> float | None:
    if not rows:
        return None
    ordered = sorted(rows)
    position = (len(ordered) - 1) * percentile
    lo, hi = math.floor(position), math.ceil(position)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


def median_absolute_deviation(rows: list[float], median: float | None) -> float | None:
    if not rows or median is None:
        return None
    return statistics.median(abs(row - median) for row in rows)


def cell_key(lat: float, lon: float, metres: float) -> tuple[int, int]:
    y = math.floor(lat * 111_320 / metres)
    x = math.floor(lon * 111_320 * max(0.1, math.cos(math.radians(lat))) / metres)
    return y, x


def feature_center(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Point" and isinstance(coordinates, list) and len(coordinates) >= 2:
        return float(coordinates[1]), float(coordinates[0])
    flattened: list[float] = []

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, (int, float)):
            flattened.append(float(value))

    visit(coordinates)
    if len(flattened) < 2:
        return None
    pairs = list(zip(flattened[1::2], flattened[::2]))
    return sum(pair[0] for pair in pairs) / len(pairs), sum(pair[1] for pair in pairs) / len(pairs)


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def classify_osm(feature: dict[str, Any]) -> str | None:
    tags = feature.get("properties") or {}
    plant_source = str(tags.get("plant:source", "")).lower()
    generator_source = str(tags.get("generator:source", "")).lower()
    if (tags.get("power") in {"plant", "generator"}) and ("solar" in plant_source or "solar" in generator_source):
        return "STATIC_SOLAR_GLINT"
    if (
        tags.get("landuse") == "industrial"
        or "industrial" in tags
        or tags.get("power") == "plant"
        or tags.get("man_made") in {"chimney", "flare", "works"}
    ):
        return "STATIC_INDUSTRIAL"
    return None


def load_osm(path: Path | None) -> list[tuple[tuple[float, float], str]]:
    if not path:
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("features", []) if isinstance(payload, dict) else []
    output = []
    for feature in rows:
        classification = classify_osm(feature)
        center = feature_center(feature)
        if classification and center:
            output.append((center, classification))
    return output


def source_family(row: dict[str, Any]) -> str:
    source = " ".join(filter(None, [value(row, "sourceId", "source", "product", "instrument", "sensor")])).lower()
    if "slstr" in source:
        return "slstr"
    if "mtg" in source or "fci" in source:
        return "mtg"
    if "modis" in source:
        return "modis"
    if "viirs" in source or "noaa" in source or "snpp" in source:
        return "viirs"
    return "unknown"


def day_night(row: dict[str, Any]) -> str | None:
    """Use the producer-provided flag; do not infer solar behavior from UTC."""
    raw = (value(row, "daynight", "dayNight", "day_night") or "").strip().lower()
    if raw in {"d", "day"}:
        return "day"
    if raw in {"n", "night"}:
        return "night"
    return None


def rows_from_csv(paths: Iterable[Path]) -> Iterable[dict[str, Any]]:
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as stream:
            yield from csv.DictReader(stream)


def build(args: argparse.Namespace) -> dict[str, Any]:
    cells: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in rows_from_csv(args.input):
        lat = float_value(row, "latitude", "lat", "Lat")
        lon = float_value(row, "longitude", "lon", "Lon")
        if lat is None or lon is None:
            continue
        row["_lat"], row["_lon"] = lat, lon
        cells[cell_key(lat, lon, args.cell_metres)].append(row)

    osm = load_osm(args.osm)
    min_unique_days = getattr(args, "min_unique_days", 2)
    features = []
    for key in sorted(cells):
        rows = cells[key]
        dates = [parse_time(row) for row in rows]
        dates = [date for date in dates if date]
        if len(rows) < args.min_detections:
            continue
        # A bare detection count is not enough: a short fire burst can pile
        # up many observations in one cell within a day or two.  Require the
        # cell to repeat across several unique days.
        unique_days = len({date.date().isoformat() for date in dates})
        if unique_days < min_unique_days:
            continue
        lat = statistics.fmean(float(row["_lat"]) for row in rows)
        lon = statistics.fmean(float(row["_lon"]) for row in rows)
        frps = [float_value(row, "frp", "frpMw", "FRP") for row in rows]
        frps = [frp for frp in frps if frp is not None]
        median = statistics.median(frps) if frps else None
        acquisition_times = [day_night(row) for row in rows]
        day_count = sum(1 for item in acquisition_times if item == "day")
        night_count = sum(1 for item in acquisition_times if item == "night")
        center = (lat, lon)
        distances = [distance_km(center, (float(row["_lat"]), float(row["_lon"]))) for row in rows]
        classification = "PERSISTENT_UNKNOWN"
        nearby_osm = sorted(
            (distance_km(center, osm_center), kind)
            for osm_center, kind in osm
            if distance_km(center, osm_center) <= args.osm_radius_km
        )
        solar_nearby = any(kind == "STATIC_SOLAR_GLINT" for _, kind in nearby_osm)
        industrial_nearby = any(kind == "STATIC_INDUSTRIAL" for _, kind in nearby_osm)
        # Solar glint needs strong day dominance on top of OSM solar evidence.
        # A night-dominant repeater next to a solar farm is heat from
        # neighbouring industry, not panel glint, so it must not be labelled
        # STATIC_SOLAR_GLINT.
        if solar_nearby and day_count >= 3 and day_count >= 3 * night_count:
            classification = "STATIC_SOLAR_GLINT"
        elif industrial_nearby:
            classification = "STATIC_INDUSTRIAL"
        properties = {
            "countryCode": args.country,
            "classification": classification,
            "cellMetres": args.cell_metres,
            "radiusKm": max(args.cell_metres / 1000, max(distances, default=0.0)) + args.radius_padding_km,
            "detectionCount": len(rows),
            "uniqueDetectionDays": len({date.date().isoformat() for date in dates}),
            "uniqueMonths": len({date.strftime("%Y-%m") for date in dates}),
            "dayCount": day_count,
            "nightCount": night_count,
            "dayNightRatio": day_count / night_count if night_count else None,
            "unknownDayNightCount": len(rows) - day_count - night_count,
            "medianFrpMw": median,
            "p90FrpMw": quantile(frps, 0.90),
            "p99FrpMw": quantile(frps, 0.99),
            "frpMadMw": median_absolute_deviation(frps, median),
            "centroidVarianceKm2": statistics.fmean(distance * distance for distance in distances) if distances else 0.0,
            "locationVarianceKm2": statistics.fmean(distance * distance for distance in distances) if distances else 0.0,
            "satelliteCount": len({value(row, "satellite", "platform") for row in rows if value(row, "satellite", "platform")} ),
            "sourceCount": len({value(row, "sourceId", "source") for row in rows if value(row, "sourceId", "source")}),
            "sensorFamilyCount": len({source_family(row) for row in rows if source_family(row) != "unknown"}),
            "historyStart": min((date.isoformat() for date in dates), default=None),
            "historyEnd": max((date.isoformat() for date in dates), default=None),
        }
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": properties})
    history_starts = [feature["properties"]["historyStart"] for feature in features if feature["properties"]["historyStart"]]
    history_ends = [feature["properties"]["historyEnd"] for feature in features if feature["properties"]["historyEnd"]]
    return {"type": "FeatureCollection", "metadata": {"builder": "gridrisk-persistent-thermal-sources", "countryCode": args.country, "cellMetres": args.cell_metres, "source": "offline canonical observation history", "featureCount": len(features), "historyStart": min(history_starts) if history_starts else None, "historyEnd": max(history_ends) if history_ends else None}, "features": features}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, nargs="+", help="Canonical historical FIRMS/thermal CSV export(s)")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--country", required=True)
    parser.add_argument("--osm", type=Path, help="Optional reviewed OSM GeoJSON extract")
    parser.add_argument("--cell-metres", type=float, default=500)
    parser.add_argument("--min-detections", type=int, default=5)
    parser.add_argument("--min-unique-days", type=int, default=2)
    parser.add_argument("--osm-radius-km", type=float, default=1.0)
    parser.add_argument("--radius-padding-km", type=float, default=0.25)
    args = parser.parse_args()
    result = build(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(result['features'])} persistent thermal-source features to {args.output}")


if __name__ == "__main__":
    main()
