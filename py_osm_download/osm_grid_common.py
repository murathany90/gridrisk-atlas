#!/usr/bin/env python3
"""Shared, resumable ArcGIS OSM Europe downloader and grid normalizer.

The ArcGIS layers are an OpenStreetMap-derived transport.  Raw OSM ``voltage``
tags are always volts; this module deliberately keeps that rule separate from
fields whose names explicitly declare kV.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import requests
from requests.adapters import HTTPAdapter
from shapely.geometry import GeometryCollection, MultiLineString, box, mapping, shape
from shapely.ops import linemerge, unary_union


LINE_ENDPOINT = (
    "https://services-eu1.arcgis.com/zci5bUiJ8olAal7N/ArcGIS/rest/services/"
    "OpenStreetMap_Power_Lines_for_Europe/FeatureServer/0/query"
)
STRUCTURE_ENDPOINT = (
    "https://services-eu1.arcgis.com/zci5bUiJ8olAal7N/ArcGIS/rest/services/"
    "OpenStreetMap_Power_Structures_for_Europe/FeatureServer/0/query"
)
SOURCE_PROVIDER = "OpenStreetMap via ArcGIS OSM Europe"
SOURCE_PROVIDER_SHORT = "ArcGIS OSM Europe"
ATTRIBUTION = "© OpenStreetMap contributors"
LICENSE = "ODbL 1.0"
USER_AGENT = "GridMoni/3.6.1 (+https://github.com/murathany90/tr_wildfire)"
OUT_FIELDS = (
    "OBJECTID,osm_id,osm_id2,osm_version,osm_timestamp,power,voltage,name,ref,"
    "operator,frequency,cables,wires,line,substation,location"
)
LINE_TYPES = {"line", "minor_line", "cable"}
POWER_TYPES = LINE_TYPES | {"substation"}
OSM_COUNTRY_CODES = frozenset({"ES", "FR", "PT", "IT"})
RETRY_STATUSES = {429, 500, 502, 503, 504}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json_write(path: Path, payload: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    text = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
        allow_nan=False,
    )
    temp.write_text(text, encoding="utf-8")
    os.replace(temp, path)


def extract_positive_numeric_tokens(value: Any) -> list[float]:
    """Extract every finite, positive numeric token without unit conversion."""

    if value is None or isinstance(value, bool):
        return []
    if isinstance(value, (list, tuple, set)):
        values: list[float] = []
        for item in value:
            values.extend(extract_positive_numeric_tokens(item))
        return values
    if isinstance(value, (int, float)):
        number = float(value)
        return [number] if math.isfinite(number) and number > 0 else []
    values = []
    for token in re.findall(r"(?<![\w.])-?\d+(?:[.,]\d+)?", str(value)):
        try:
            number = float(token.replace(",", "."))
        except ValueError:
            continue
        if math.isfinite(number) and number > 0:
            values.append(number)
    return values


def parse_osm_voltage_kv(value: Any) -> list[float]:
    """Parse a raw OSM voltage tag (always volts) into sorted unique kV."""

    return sorted({number / 1000.0 for number in extract_positive_numeric_tokens(value)})


def parse_feature_voltages_kv(properties: dict[str, Any]) -> list[float]:
    """Use raw OSM voltage first; trust explicit kV fields only when raw is absent."""

    for key in ("voltage", "voltageRaw"):
        value = properties.get(key)
        if value not in (None, ""):
            return parse_osm_voltage_kv(value)
    values: list[float] = []
    for key in ("actualVoltagesKv", "voltagesKv", "actualVoltageKv", "voltageMaxKv"):
        values.extend(extract_positive_numeric_tokens(properties.get(key)))
    return sorted(set(values))


def voltage_class(voltage_kv: float | None) -> str | None:
    if voltage_kv is None:
        return None
    if 300 <= voltage_kv <= 550:
        return "400"
    if 50 <= voltage_kv < 300:
        return "154"
    return None


def load_boundary(path: str | Path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("type") == "FeatureCollection":
        features = data.get("features") or []
        if len(features) != 1:
            raise ValueError(f"Boundary must contain exactly one feature: {path}")
        geometry = features[0].get("geometry")
    elif data.get("type") == "Feature":
        geometry = data.get("geometry")
    else:
        geometry = data
    boundary = shape(geometry)
    if boundary.is_empty or not boundary.is_valid or boundary.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError(f"Invalid country Polygon/MultiPolygon boundary: {path}")
    return boundary


def valid_geojson_geometry(geometry: Any) -> bool:
    if not isinstance(geometry, dict) or not geometry.get("type") or geometry.get("coordinates") is None:
        return False
    try:
        candidate = shape(geometry)
    except (TypeError, ValueError):
        return False
    if candidate.is_empty or not candidate.is_valid:
        return False
    try:
        return all(math.isfinite(float(value)) for point in _iter_positions(geometry["coordinates"]) for value in point)
    except (TypeError, ValueError):
        return False


def _iter_positions(value: Any) -> Iterable[tuple[float, float]]:
    if (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        yield float(value[0]), float(value[1])
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _iter_positions(item)


def geometry_intersects_boundary(geometry: dict[str, Any], boundary) -> bool:
    return valid_geojson_geometry(geometry) and shape(geometry).intersects(boundary)


def normalize_osm_id(properties: dict[str, Any]) -> str | None:
    for key in ("osm_id2", "osm_id", "osmId"):
        value = properties.get(key)
        if value not in (None, ""):
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            text = str(value).strip()
            if text:
                return text
    return None


def normalized_osm_type(power: str, geometry_type: str, properties: dict[str, Any]) -> str:
    explicit = str(properties.get("osmType") or properties.get("osm_type") or "").strip().lower()
    if explicit in {"node", "way", "relation"}:
        return explicit
    if power in LINE_TYPES or geometry_type in {"Polygon", "MultiPolygon", "LineString", "MultiLineString"}:
        return "way"
    return "node"


def feature_key(country: str, feature: dict[str, Any]) -> str:
    properties = feature.get("properties") or {}
    power = str(properties.get("power") or properties.get("elementType") or "").strip().lower()
    geometry = feature.get("geometry") or {}
    osm_type = normalized_osm_type(power, str(geometry.get("type") or ""), properties)
    osm_id = normalize_osm_id(properties)
    if osm_id:
        return f"{country}:{power}:{osm_type}:{osm_id}"
    canonical = json.dumps(geometry, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    voltage = ";".join(f"{v:g}" for v in parse_feature_voltages_kv(properties))
    operator = str(properties.get("operator") or "")
    digest = hashlib.sha256(f"{canonical}|{voltage}|{operator}".encode("utf-8")).hexdigest()[:24]
    return f"{country}:{power}:geometry:{digest}"


def _timestamp_value(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        pass
    for fmt in ("%b %d %Y %I:%M%p", "%b  %d %Y %I:%M%p"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
    return 0.0


def property_completeness(properties: dict[str, Any]) -> int:
    keys = ("name", "ref", "operator", "voltage", "osm_timestamp", "frequency", "cables", "wires")
    return sum(properties.get(key) not in (None, "") for key in keys)


def choose_preferred_feature(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Prefer timestamp, then richer properties, then more detailed geometry."""

    lp, rp = left.get("properties") or {}, right.get("properties") or {}
    left_timestamp = _timestamp_value(lp.get("osm_timestamp") or lp.get("osmTimestamp"))
    right_timestamp = _timestamp_value(rp.get("osm_timestamp") or rp.get("osmTimestamp"))
    try:
        left_version = int(lp.get("osm_version") or lp.get("osmVersion") or 0)
    except (TypeError, ValueError):
        left_version = 0
    try:
        right_version = int(rp.get("osm_version") or rp.get("osmVersion") or 0)
    except (TypeError, ValueError):
        right_version = 0
    left_rank = (
        left_timestamp,
        left_version,
        property_completeness(lp),
        len(json.dumps(left.get("geometry") or {}, separators=(",", ":"))),
    )
    right_rank = (
        right_timestamp,
        right_version,
        property_completeness(rp),
        len(json.dumps(right.get("geometry") or {}, separators=(",", ":"))),
    )
    preferred, other = (right, left) if right_rank > left_rank else (left, right)
    # If the same OSM line is returned as genuinely different valid fragments,
    # retain both pieces as a MultiLineString instead of silently deleting one.
    a, b = preferred.get("geometry") or {}, other.get("geometry") or {}
    same_revision = left_timestamp == right_timestamp and left_version == right_version
    if same_revision and a != b and a.get("type") in {"LineString", "MultiLineString"} and b.get("type") in {"LineString", "MultiLineString"}:
        try:
            merged = linemerge(unary_union([shape(a), shape(b)]))
            if merged.geom_type in {"LineString", "MultiLineString"} and merged.is_valid:
                preferred = {**preferred, "geometry": mapping(merged)}
        except (TypeError, ValueError):
            pass
    return preferred


def normalize_downloaded_feature(country: str, feature: dict[str, Any], boundary) -> tuple[dict[str, Any] | None, str]:
    properties = feature.get("properties") or {}
    if not isinstance(properties, dict):
        return None, "invalid-properties"
    power = str(properties.get("power") or "").strip().lower()
    geometry = feature.get("geometry")
    if power not in POWER_TYPES:
        return None, "unsupported-power"
    if not valid_geojson_geometry(geometry):
        return None, "invalid-geometry"
    geometry_type = str(geometry.get("type"))
    if power in LINE_TYPES and geometry_type not in {"LineString", "MultiLineString"}:
        return None, "unsupported-geometry"
    if power == "substation" and geometry_type not in {"Point", "Polygon", "MultiPolygon"}:
        return None, "unsupported-geometry"
    if not shape(geometry).intersects(boundary):
        return None, "outside-boundary"
    voltages = parse_feature_voltages_kv(properties)
    actual = max(voltages) if voltages else None
    if actual is None:
        return None, "missing-voltage"
    if actual < 50:
        return None, "below-50"
    if actual > 550:
        return None, "above-550"
    osm_id = normalize_osm_id(properties)
    osm_type = normalized_osm_type(power, geometry_type, properties)
    clean = {
        key: properties.get(key)
        for key in (
            "OBJECTID", "osm_id", "osm_id2", "osm_version", "osm_timestamp", "power",
            "voltage", "name", "ref", "operator", "frequency", "cables", "wires",
            "line", "substation", "location",
        )
        if properties.get(key) not in (None, "")
    }
    clean.update(
        {
            "countryCode": country,
            "elementType": power,
            "osmType": osm_type,
            "osmId": osm_id,
            "voltageRaw": properties.get("voltage"),
            "actualVoltagesKv": voltages,
            "actualVoltageKv": actual,
            "gridClass": voltage_class(actual),
            "sourceProvider": properties.get("sourceProvider") or SOURCE_PROVIDER_SHORT,
            "sourceFallback": properties.get("sourceFallback"),
        }
    )
    return {"type": "Feature", "properties": clean, "geometry": geometry}, "accepted"


@dataclass(frozen=True)
class Tile:
    country: str
    kind: str
    bbox: tuple[float, float, float, float]
    depth: int = 0
    parent: str | None = None

    @property
    def id(self) -> str:
        coords = ",".join(f"{value:.6f}" for value in self.bbox)
        digest = hashlib.sha1(f"{self.country}|{self.kind}|{coords}".encode()).hexdigest()[:12]
        return f"{self.kind}-{self.depth}-{digest}"


@dataclass
class TileResult:
    tile: Tile
    features: list[dict[str, Any]] = field(default_factory=list)
    raw_count: int = 0
    page_count: int = 0
    exceeded_transfer_limit: bool = False
    used_id_fallback: bool = False
    attempts: int = 0
    error: str | None = None


class RetryableDownloadError(RuntimeError):
    pass


class ArcGISClient:
    def __init__(self, *, timeout: float, max_retries: int, backoff: float = 1.0):
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff = backoff
        self.session = self._new_session()

    @staticmethod
    def _new_session() -> requests.Session:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/geo+json, application/json"})
        session.mount("https://", HTTPAdapter(pool_connections=4, pool_maxsize=4, max_retries=0))
        return session

    def reset_session(self) -> None:
        self.session.close()
        self.session = self._new_session()

    def get_json(self, endpoint: str, params: dict[str, Any]) -> tuple[dict[str, Any], int]:
        last_error = "unknown error"
        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.session.get(endpoint, params=params, timeout=self.timeout)
                if response.status_code in RETRY_STATUSES:
                    raise RetryableDownloadError(f"HTTP {response.status_code}")
                response.raise_for_status()
                payload = response.json()
                if payload.get("error"):
                    code = int((payload.get("error") or {}).get("code") or 0)
                    message = json.dumps(payload["error"], ensure_ascii=False)
                    if code in RETRY_STATUSES or code >= 500:
                        raise RetryableDownloadError(f"ArcGIS {code}: {message}")
                    raise RuntimeError(f"ArcGIS {code}: {message}")
                return payload, attempt
            except (requests.Timeout, requests.ConnectionError, RetryableDownloadError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                self.reset_session()
                if attempt < self.max_retries:
                    delay = min(30.0, self.backoff * (2 ** (attempt - 1))) + random.uniform(0, 0.25)
                    time.sleep(delay)
            except (requests.HTTPError, ValueError) as exc:
                raise RuntimeError(f"{type(exc).__name__}: {exc}") from exc
        raise RetryableDownloadError(last_error)


def _base_params(tile: Tile, where: str) -> dict[str, Any]:
    return {
        "where": where,
        "geometry": ",".join(f"{value:.8f}" for value in tile.bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outSR": 4326,
    }


def fetch_by_object_ids(client: ArcGISClient, endpoint: str, tile: Tile, where: str, page_size: int) -> TileResult:
    id_params = {**_base_params(tile, where), "returnIdsOnly": "true", "returnGeometry": "false", "f": "json"}
    id_payload, attempts = client.get_json(endpoint, id_params)
    object_ids = sorted({int(value) for value in (id_payload.get("objectIds") or [])})
    features: list[dict[str, Any]] = []
    pages = 0
    for index in range(0, len(object_ids), page_size):
        batch = object_ids[index : index + page_size]
        params = {
            "objectIds": ",".join(map(str, batch)),
            "outFields": OUT_FIELDS,
            "outSR": 4326,
            "returnGeometry": "true",
            "f": "geojson",
        }
        payload, batch_attempts = client.get_json(endpoint, params)
        attempts += batch_attempts
        part = payload.get("features") or []
        if not isinstance(part, list):
            raise RuntimeError("ArcGIS object-ID response has no feature list")
        features.extend(part)
        pages += 1
    if len(features) != len(object_ids):
        raise RetryableDownloadError(f"object-ID fallback expected {len(object_ids)}, received {len(features)}")
    return TileResult(
        tile=tile,
        features=features,
        raw_count=len(features),
        page_count=pages,
        used_id_fallback=True,
        attempts=attempts,
    )


def fetch_tile(client: ArcGISClient, endpoint: str, tile: Tile, where: str, page_size: int = 2000) -> TileResult:
    features: list[dict[str, Any]] = []
    seen_page_ids: set[str] = set()
    offset = 0
    page_count = 0
    attempts = 0
    transfer_seen = False
    try:
        while True:
            params = {
                **_base_params(tile, where),
                "outFields": OUT_FIELDS,
                "returnGeometry": "true",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "orderByFields": "OBJECTID ASC",
                "f": "geojson",
            }
            payload, page_attempts = client.get_json(endpoint, params)
            attempts += page_attempts
            page = payload.get("features") or []
            if not isinstance(page, list):
                raise RuntimeError("ArcGIS pagination response has no feature list")
            exceeded = bool(payload.get("exceededTransferLimit") or (payload.get("properties") or {}).get("exceededTransferLimit"))
            transfer_seen = transfer_seen or exceeded
            if not page:
                if exceeded:
                    return fetch_by_object_ids(client, endpoint, tile, where, page_size)
                break
            fingerprint = hashlib.sha1(
                "|".join(str((item.get("properties") or {}).get("OBJECTID")) for item in page).encode()
            ).hexdigest()
            if fingerprint in seen_page_ids:
                return fetch_by_object_ids(client, endpoint, tile, where, page_size)
            seen_page_ids.add(fingerprint)
            features.extend(page)
            page_count += 1
            if len(page) < page_size and not exceeded:
                break
            offset += len(page)
        return TileResult(
            tile=tile,
            features=features,
            raw_count=len(features),
            page_count=page_count,
            exceeded_transfer_limit=transfer_seen,
            attempts=attempts,
        )
    except RetryableDownloadError:
        return fetch_by_object_ids(client, endpoint, tile, where, page_size)


def split_tile(tile: Tile) -> list[Tile]:
    west, south, east, north = tile.bbox
    mid_x, mid_y = (west + east) / 2, (south + north) / 2
    return [
        Tile(tile.country, tile.kind, bbox_, tile.depth + 1, tile.id)
        for bbox_ in (
            (west, south, mid_x, mid_y),
            (mid_x, south, east, mid_y),
            (west, mid_y, mid_x, north),
            (mid_x, mid_y, east, north),
        )
    ]


def iter_tiles(country: str, kind: str, boundary, chunk_size: float) -> list[Tile]:
    west, south, east, north = boundary.bounds
    tiles: list[Tile] = []
    y = math.floor(south / chunk_size) * chunk_size
    while y < north:
        x = math.floor(west / chunk_size) * chunk_size
        while x < east:
            bbox_ = (x, y, min(x + chunk_size, east), min(y + chunk_size, north))
            if box(*bbox_).intersects(boundary):
                tiles.append(Tile(country, kind, bbox_))
            x += chunk_size
        y += chunk_size
    return tiles


def _checkpoint_path(checkpoint_dir: Path, tile: Tile) -> Path:
    return checkpoint_dir / f"{tile.id}.json"


def save_checkpoint(checkpoint_dir: Path, result: TileResult) -> None:
    atomic_json_write(
        _checkpoint_path(checkpoint_dir, result.tile),
        {
            "tile": asdict(result.tile),
            "rawCount": result.raw_count,
            "pageCount": result.page_count,
            "exceededTransferLimit": result.exceeded_transfer_limit,
            "usedIdFallback": result.used_id_fallback,
            "attempts": result.attempts,
            "features": result.features,
        },
    )


def load_checkpoint(checkpoint_dir: Path, tile: Tile) -> TileResult | None:
    path = _checkpoint_path(checkpoint_dir, tile)
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return TileResult(
        tile=tile,
        features=payload.get("features") or [],
        raw_count=int(payload.get("rawCount") or 0),
        page_count=int(payload.get("pageCount") or 0),
        exceeded_transfer_limit=bool(payload.get("exceededTransferLimit")),
        used_id_fallback=bool(payload.get("usedIdFallback")),
        attempts=int(payload.get("attempts") or 0),
    )


def _tile_polygon_feature(tile: Tile, properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "Feature", "properties": {"tileId": tile.id, "kind": tile.kind, **properties}, "geometry": mapping(box(*tile.bbox))}


def _touches(a: Tile, b: Tile, tolerance: float = 1e-8) -> bool:
    aw, as_, ae, an = a.bbox
    bw, bs, be, bn = b.bbox
    horizontal = abs(ae - bw) <= tolerance or abs(be - aw) <= tolerance
    vertical_overlap = min(an, bn) - max(as_, bs) > tolerance
    vertical = abs(an - bs) <= tolerance or abs(bn - as_) <= tolerance
    horizontal_overlap = min(ae, be) - max(aw, bw) > tolerance
    return (horizontal and vertical_overlap) or (vertical and horizontal_overlap)


def find_suspicious_zero_tiles(results: Sequence[TileResult], boundary=None) -> list[Tile]:
    line_results = [result for result in results if result.tile.kind == "line" and result.tile.depth == 0]
    suspicious = []
    for result in line_results:
        if result.raw_count:
            continue
        tile_geometry = box(*result.tile.bbox)
        if boundary is not None and tile_geometry.intersection(boundary).area / max(tile_geometry.area, 1e-12) < 0.1:
            continue
        neighbours = [other.raw_count for other in line_results if _touches(result.tile, other.tile)]
        if len([count for count in neighbours if count > 0]) >= 2 and sum(neighbours) >= 20:
            suspicious.append(result.tile)
    return suspicious


def _process_tile(
    tile: Tile,
    *,
    endpoint: str,
    where: str,
    timeout: float,
    max_retries: int,
    checkpoint_dir: Path,
    resume: bool,
) -> TileResult:
    if resume:
        saved = load_checkpoint(checkpoint_dir, tile)
        if saved is not None:
            return saved
    client = ArcGISClient(timeout=timeout, max_retries=max_retries)
    result = fetch_tile(client, endpoint, tile, where)
    save_checkpoint(checkpoint_dir, result)
    return result


def _run_tiles(
    tiles: Sequence[Tile],
    *,
    endpoints: dict[str, str],
    where_by_kind: dict[str, str],
    timeout: float,
    max_retries: int,
    checkpoint_dir: Path,
    resume: bool,
    workers: int,
    country: str,
) -> tuple[list[TileResult], list[dict[str, Any]]]:
    results: list[TileResult] = []
    failures: list[dict[str, Any]] = []
    total = len(tiles)
    line_count = sub_count = 0

    def run_one(tile: Tile) -> TileResult:
        return _process_tile(
            tile,
            endpoint=endpoints[tile.kind],
            where=where_by_kind[tile.kind],
            timeout=timeout,
            max_retries=max_retries,
            checkpoint_dir=checkpoint_dir,
            resume=resume,
        )

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(run_one, tile): tile for tile in tiles}
        for completed, future in enumerate(as_completed(futures), start=1):
            tile = futures[future]
            try:
                result = future.result()
                results.append(result)
                if tile.kind == "line":
                    line_count += result.raw_count
                else:
                    sub_count += result.raw_count
            except Exception as exc:  # split/retry is handled by the caller
                failures.append(
                    {
                        "country": country,
                        "endpoint": endpoints[tile.kind],
                        "bbox": list(tile.bbox),
                        "where": where_by_kind[tile.kind],
                        "attempts": max_retries,
                        "lastError": f"{type(exc).__name__}: {exc}",
                        "timestamp": utc_now(),
                        "tileId": tile.id,
                        "kind": tile.kind,
                        "depth": tile.depth,
                        "parent": tile.parent,
                    }
                )
            print(
                f"country={country} completed_tiles={completed}/{total} raw_features={line_count + sub_count} "
                f"unique_features=pending failed_tiles={len(failures)} lines={line_count} substations={sub_count}",
                flush=True,
            )
    return results, failures


def run_download(args: argparse.Namespace, country: str, coverage: str) -> dict[str, Any]:
    output = Path(args.output).expanduser().resolve()
    manifest_path = output.with_suffix(".manifest.json")
    if args.validate_only:
        if not output.exists():
            raise FileNotFoundError(output)
        data = json.loads(output.read_text(encoding="utf-8"))
        diagnostics = validate_collection(data, country, load_boundary(args.country_boundary))
        print(json.dumps(diagnostics, ensure_ascii=False, indent=2))
        if diagnostics["invalidGeometryCount"] or diagnostics["outsideBoundaryCount"] or diagnostics["duplicateCount"]:
            raise SystemExit(1)
        if (data.get("metadata") or {}).get("downloadDiagnostics", {}).get("partial"):
            raise SystemExit(2)
        return diagnostics
    if output.exists() and not args.force and not args.resume:
        raise FileExistsError(f"Output exists; use --resume or --force: {output}")

    boundary = load_boundary(args.country_boundary)
    checkpoint_dir = output.parent / f".{output.stem}-{country}-checkpoint"
    if args.force and checkpoint_dir.exists():
        shutil.rmtree(checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    endpoints = {"line": LINE_ENDPOINT, "substation": STRUCTURE_ENDPOINT}
    where_by_kind = {
        "line": "power IN ('line','minor_line','cable') AND voltage IS NOT NULL",
        "substation": "power = 'substation' AND voltage IS NOT NULL",
    }
    initial_tiles = [
        *iter_tiles(country, "line", boundary, args.chunk_size),
        *iter_tiles(country, "substation", boundary, args.chunk_size),
    ]
    results, failures = _run_tiles(
        initial_tiles,
        endpoints=endpoints,
        where_by_kind=where_by_kind,
        timeout=args.timeout,
        max_retries=args.max_retries,
        checkpoint_dir=checkpoint_dir,
        resume=args.resume,
        workers=args.workers,
        country=country,
    )

    # Failed requests are split into four subtiles.  Continue until a small
    # tile succeeds or the configured split depth is exhausted.
    depth = 0
    while failures and depth < args.max_split_depth:
        retry_tiles = []
        previous_failures = failures
        failures = []
        for failure in previous_failures:
            failed_tile = next(tile for tile in initial_tiles + [r.tile for r in results] if tile.id == failure["tileId"])
            retry_tiles.extend(child for child in split_tile(failed_tile) if box(*child.bbox).intersects(boundary))
        retry_results, failures = _run_tiles(
            retry_tiles,
            endpoints=endpoints,
            where_by_kind=where_by_kind,
            timeout=args.timeout,
            max_retries=args.max_retries,
            checkpoint_dir=checkpoint_dir,
            resume=args.resume,
            workers=args.workers,
            country=country,
        )
        results.extend(retry_results)
        initial_tiles.extend(retry_tiles)
        depth += 1

    suspicious = find_suspicious_zero_tiles(results, boundary)
    unresolved_suspicious = list(suspicious)
    if suspicious:
        refinement_tiles = [child for tile in suspicious for child in split_tile(tile) if box(*child.bbox).intersects(boundary)]
        refinement_results, refinement_failures = _run_tiles(
            refinement_tiles,
            endpoints=endpoints,
            where_by_kind=where_by_kind,
            timeout=args.timeout,
            max_retries=args.max_retries,
            checkpoint_dir=checkpoint_dir,
            resume=args.resume,
            workers=args.workers,
            country=country,
        )
        results.extend(refinement_results)
        failures.extend(refinement_failures)
        refined_by_parent: dict[str, list[TileResult]] = {}
        for result in refinement_results:
            refined_by_parent.setdefault(str(result.tile.parent), []).append(result)
        failed_parents = {str(item.get("parent")) for item in refinement_failures}
        unresolved_suspicious = [
            tile
            for tile in suspicious
            if tile.id in failed_parents or sum(item.raw_count for item in refined_by_parent.get(tile.id, [])) == 0
        ]

    normalized_by_key: dict[str, dict[str, Any]] = {}
    rejection_counts: dict[str, int] = {}
    raw_count = 0
    for result in results:
        raw_count += result.raw_count
        for feature in result.features:
            normalized, reason = normalize_downloaded_feature(country, feature, boundary)
            if normalized is None:
                rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
                continue
            key = feature_key(country, normalized)
            if key in normalized_by_key:
                normalized_by_key[key] = choose_preferred_feature(normalized_by_key[key], normalized)
            else:
                normalized_by_key[key] = normalized

    overpass_diagnostics = {
        "provider": "OpenStreetMap Overpass API",
        "processedTiles": 0,
        "failedRequests": 0,
        "failedTiles": [],
        "partial": False,
        "rawFeatureCount": 0,
        "uniqueFeatureCount": 0,
        "rejectedFeatureCount": 0,
    }
    if not args.no_overpass_fallback:
        from overpass_substations import fetch_overpass_substations

        overpass_features, overpass_diagnostics = fetch_overpass_substations(
            country,
            boundary,
            checkpoint_dir=checkpoint_dir / "overpass",
            chunk_size=args.chunk_size,
            timeout=args.timeout,
            max_retries=args.max_retries,
            max_split_depth=args.max_split_depth,
            workers=args.workers,
            resume=args.resume,
        )
        for feature in overpass_features:
            key = feature_key(country, feature)
            normalized_by_key[key] = choose_preferred_feature(normalized_by_key[key], feature) if key in normalized_by_key else feature
        failures.extend(overpass_diagnostics["failedTiles"])
    features = sorted(normalized_by_key.values(), key=lambda item: feature_key(country, item))
    line_count = sum((feature.get("properties") or {}).get("elementType") in LINE_TYPES for feature in features)
    substation_count = len(features) - line_count
    failed_tile_features = []
    for failure in failures:
        tile = Tile(country, failure["kind"], tuple(failure["bbox"]), failure["depth"], failure.get("parent"))
        failed_tile_features.append(_tile_polygon_feature(tile, failure))
    completed_tile_features = [
        _tile_polygon_feature(
            result.tile,
            {
                "rawCount": result.raw_count,
                "pageCount": result.page_count,
                "exceededTransferLimit": result.exceeded_transfer_limit,
                "usedIdFallback": result.used_id_fallback,
            },
        )
        for result in results
    ]
    suspicious_features = [
        _tile_polygon_feature(
            tile,
            {
                "reason": "zero with dense neighbours",
                "resolved": tile not in unresolved_suspicious,
            },
        )
        for tile in suspicious
    ]
    downloaded_at = utc_now()
    diagnostics = {
        "processedTiles": len(results),
        "initialTiles": len([tile for tile in initial_tiles if tile.depth == 0]),
        "failedRequests": len(failures),
        "failedTiles": failures,
        "partial": bool(failures),
        "rawFeatureCount": raw_count + int(overpass_diagnostics["rawFeatureCount"]),
        "uniqueFeatureCount": len(features),
        "duplicateCount": max(0, raw_count - sum(rejection_counts.values()) - len(features)),
        "lineCount": line_count,
        "substationCount": substation_count,
        "suspectedGapTileCount": len(unresolved_suspicious),
        "refinedSuspiciousTileCount": len(suspicious) - len(unresolved_suspicious),
        "rejectionCounts": rejection_counts,
        "exceededTransferLimitTileCount": sum(result.exceeded_transfer_limit for result in results),
        "objectIdFallbackTileCount": sum(result.used_id_fallback for result in results),
        "overpassFallback": overpass_diagnostics,
    }
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "app": "GridMoni",
            "downloadedAt": downloaded_at,
            "exportedAt": downloaded_at,
            "source": SOURCE_PROVIDER,
            "sourceProviders": [SOURCE_PROVIDER_SHORT, "OpenStreetMap Overpass API"] if not args.no_overpass_fallback else [SOURCE_PROVIDER_SHORT],
            "license": LICENSE,
            "attribution": ATTRIBUTION,
            "coverage": coverage,
            "filters": {
                "countryCode": country,
                "minimumVoltageKv": 50,
                "maximumVoltageKv": 550,
                "elementTypes": sorted(POWER_TYPES),
                "rawOsmVoltageUnit": "V",
            },
            "featureCount": len(features),
            "downloadDiagnostics": diagnostics,
        },
        "features": features,
    }
    atomic_json_write(output, collection)
    atomic_json_write(manifest_path, collection["metadata"], compact=False)
    atomic_json_write(output.with_suffix(".completed_tiles.geojson"), {"type": "FeatureCollection", "features": completed_tile_features})
    atomic_json_write(output.with_suffix(".failed_tiles.geojson"), {"type": "FeatureCollection", "features": failed_tile_features})
    atomic_json_write(output.with_suffix(".suspected_gaps.geojson"), {"type": "FeatureCollection", "features": suspicious_features})
    print(f"written={output}")
    print(
        f"country={country} completed_tiles={len(results)} total_tiles={len(results) + len(failures)} "
        f"raw_features={raw_count} unique_features={len(features)} failed_tiles={len(failures)} "
        f"lines={line_count} substations={substation_count}",
        flush=True,
    )
    if failures:
        raise RuntimeError(f"Download remains partial: {len(failures)} failed tiles; resume manifest: {manifest_path}")
    return diagnostics


def validate_collection(collection: dict[str, Any], country: str, boundary) -> dict[str, int]:
    counts = {
        "rawFeatureCount": 0,
        "validLineCount": 0,
        "validSubstationCount": 0,
        "outsideBoundaryCount": 0,
        "invalidGeometryCount": 0,
        "duplicateCount": 0,
        "invalidVoltageCount": 0,
    }
    seen: set[str] = set()
    for feature in collection.get("features") or []:
        counts["rawFeatureCount"] += 1
        geometry = feature.get("geometry")
        if not valid_geojson_geometry(geometry):
            counts["invalidGeometryCount"] += 1
            continue
        if not shape(geometry).intersects(boundary):
            counts["outsideBoundaryCount"] += 1
            continue
        key = feature_key(country, feature)
        if key in seen:
            counts["duplicateCount"] += 1
            continue
        seen.add(key)
        properties = feature.get("properties") or {}
        voltages = parse_feature_voltages_kv(properties)
        actual = max(voltages) if voltages else None
        if voltage_class(actual) is None:
            counts["invalidVoltageCount"] += 1
            continue
        power = str(properties.get("power") or properties.get("elementType") or "").lower()
        if power in LINE_TYPES:
            counts["validLineCount"] += 1
        elif power == "substation":
            counts["validSubstationCount"] += 1
    return counts


def build_cli_parser(country: str, default_output: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=f"Download complete {country} OSM power-grid data from ArcGIS OSM Europe")
    parser.add_argument("--output", default=default_output)
    parser.add_argument("--country-boundary", required=True)
    parser.add_argument("--chunk-size", type=float, default=2.0)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--max-split-depth", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-overpass-fallback", action="store_true")
    return parser


def validate_args(args: argparse.Namespace) -> None:
    if args.chunk_size <= 0:
        raise SystemExit("--chunk-size must be greater than zero")
    if args.max_retries < 1:
        raise SystemExit("--max-retries must be at least one")
    if args.max_split_depth < 0:
        raise SystemExit("--max-split-depth cannot be negative")
    if args.timeout <= 0:
        raise SystemExit("--timeout must be greater than zero")
    if args.workers < 1:
        raise SystemExit("--workers must be at least one")
