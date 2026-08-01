#!/usr/bin/env python3
"""Tiled Overpass fallback for polygon/way high-voltage substations."""

from __future__ import annotations

import json
import math
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import polygonize, unary_union

from osm_grid_common import (
    LICENSE,
    USER_AGENT,
    atomic_json_write,
    choose_preferred_feature,
    feature_key,
    normalize_downloaded_feature,
    split_tile,
    Tile,
    utc_now,
)


DEFAULT_ENDPOINTS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
OVERPASS_PROVIDER = "OpenStreetMap Overpass API"
FALLBACK_REASON = "ArcGIS structures layer omits polygon/way substations"


def _query(tile: Tile, timeout: float) -> str:
    west, south, east, north = tile.bbox
    return (
        f"[out:json][timeout:{max(25, int(timeout))}];"
        f"nwr[\"power\"=\"substation\"][\"voltage\"]({south:.8f},{west:.8f},{north:.8f},{east:.8f});"
        "out meta geom qt;"
    )


def _way_geometry(element: dict[str, Any]):
    coordinates = [
        (float(point["lon"]), float(point["lat"]))
        for point in element.get("geometry") or []
        if point.get("lon") is not None and point.get("lat") is not None
    ]
    if len(coordinates) < 2:
        return None
    if len(coordinates) >= 4 and coordinates[0] == coordinates[-1]:
        polygon = Polygon(coordinates)
        return polygon if polygon.is_valid and not polygon.is_empty else None
    line = LineString(coordinates)
    return line if line.is_valid and not line.is_empty else None


def _relation_geometry(element: dict[str, Any]):
    outer_lines = []
    inner_lines = []
    for member in element.get("members") or []:
        coordinates = [
            (float(point["lon"]), float(point["lat"]))
            for point in member.get("geometry") or []
            if point.get("lon") is not None and point.get("lat") is not None
        ]
        if len(coordinates) < 2:
            continue
        line = LineString(coordinates)
        (inner_lines if member.get("role") == "inner" else outer_lines).append(line)
    polygons = list(polygonize(unary_union(outer_lines))) if outer_lines else []
    if not polygons:
        return None
    outer = unary_union(polygons)
    if inner_lines:
        holes = list(polygonize(unary_union(inner_lines)))
        if holes:
            outer = outer.difference(unary_union(holes))
    if outer.geom_type in {"Polygon", "MultiPolygon"} and outer.is_valid and not outer.is_empty:
        return outer
    return None


def element_to_feature(element: dict[str, Any]) -> dict[str, Any] | None:
    element_type = str(element.get("type") or "")
    if element_type == "node" and element.get("lon") is not None and element.get("lat") is not None:
        geometry = Point(float(element["lon"]), float(element["lat"]))
    elif element_type == "way":
        geometry = _way_geometry(element)
    elif element_type == "relation":
        geometry = _relation_geometry(element)
    else:
        geometry = None
    if geometry is None or geometry.geom_type not in {"Point", "Polygon", "MultiPolygon"}:
        return None
    tags = element.get("tags") or {}
    osm_id = str(element.get("id"))
    properties = {
        "osm_id": osm_id,
        "osm_id2": osm_id,
        "osmType": element_type,
        "osm_timestamp": element.get("timestamp"),
        "power": tags.get("power"),
        "voltage": tags.get("voltage"),
        "name": tags.get("name"),
        "ref": tags.get("ref"),
        "operator": tags.get("operator"),
        "frequency": tags.get("frequency"),
        "cables": tags.get("cables"),
        "location": tags.get("location"),
        "sourceProvider": OVERPASS_PROVIDER,
        "sourceFallback": FALLBACK_REASON,
    }
    return {"type": "Feature", "properties": properties, "geometry": mapping(geometry)}


@dataclass
class OverpassResult:
    tile: Tile
    features: list[dict[str, Any]]
    raw_count: int
    attempts: int
    endpoint: str


class OverpassClient:
    def __init__(self, endpoints=DEFAULT_ENDPOINTS, *, timeout=90.0, max_retries=5):
        self.endpoints = tuple(endpoints)
        self.timeout = timeout
        self.max_retries = max_retries

    def fetch(self, tile: Tile) -> OverpassResult:
        last_error = "unknown error"
        endpoint_offset = int(tile.id.rsplit("-", 1)[-1][:8], 16) % len(self.endpoints)
        for attempt in range(1, self.max_retries + 1):
            endpoint = self.endpoints[(endpoint_offset + attempt - 1) % len(self.endpoints)]
            session = requests.Session()
            session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                response = session.post(endpoint, data={"data": _query(tile, self.timeout)}, timeout=self.timeout + 20)
                if response.status_code in {429, 500, 502, 503, 504}:
                    raise RuntimeError(f"HTTP {response.status_code}")
                response.raise_for_status()
                payload = response.json()
                if payload.get("remark") and not isinstance(payload.get("elements"), list):
                    raise RuntimeError(str(payload["remark"]))
                elements = payload.get("elements") or []
                features = [feature for element in elements if (feature := element_to_feature(element)) is not None]
                return OverpassResult(tile, features, len(elements), attempt, endpoint)
            except (requests.RequestException, RuntimeError, ValueError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < self.max_retries:
                    time.sleep(min(30.0, 2 ** (attempt - 1)) + random.uniform(0, 0.3))
            finally:
                session.close()
        raise RuntimeError(last_error)


def _checkpoint_path(directory: Path, tile: Tile) -> Path:
    return directory / f"overpass-{tile.id}.json"


def _save(directory: Path, result: OverpassResult) -> None:
    atomic_json_write(
        _checkpoint_path(directory, result.tile),
        {
            "tile": {
                "country": result.tile.country,
                "kind": result.tile.kind,
                "bbox": result.tile.bbox,
                "depth": result.tile.depth,
                "parent": result.tile.parent,
            },
            "features": result.features,
            "rawCount": result.raw_count,
            "attempts": result.attempts,
            "endpoint": result.endpoint,
        },
    )


def _load(directory: Path, tile: Tile) -> OverpassResult | None:
    path = _checkpoint_path(directory, tile)
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return OverpassResult(
        tile,
        payload.get("features") or [],
        int(payload.get("rawCount") or 0),
        int(payload.get("attempts") or 0),
        str(payload.get("endpoint") or "checkpoint"),
    )


def _tiles(country: str, boundary, step: float) -> list[Tile]:
    west, south, east, north = boundary.bounds
    output = []
    y = math.floor(south / step) * step
    while y < north:
        x = math.floor(west / step) * step
        while x < east:
            bbox_ = (x, y, min(x + step, east), min(y + step, north))
            if box(*bbox_).intersects(boundary):
                output.append(Tile(country, "substation", bbox_))
            x += step
        y += step
    return output


def _run(
    tiles: list[Tile],
    *,
    checkpoint_dir: Path,
    resume: bool,
    timeout: float,
    max_retries: int,
    workers: int,
) -> tuple[list[OverpassResult], list[dict[str, Any]]]:
    results = []
    failures = []

    def work(tile: Tile):
        saved = _load(checkpoint_dir, tile) if resume else None
        if saved:
            return saved
        result = OverpassClient(timeout=timeout, max_retries=max_retries).fetch(tile)
        _save(checkpoint_dir, result)
        return result

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(work, tile): tile for tile in tiles}
        for index, future in enumerate(as_completed(futures), start=1):
            tile = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as exc:
                failures.append(
                    {
                        "country": tile.country,
                        "endpoint": list(DEFAULT_ENDPOINTS),
                        "bbox": list(tile.bbox),
                        "where": 'nwr["power"="substation"]["voltage"]',
                        "attempts": max_retries,
                        "lastError": f"{type(exc).__name__}: {exc}",
                        "timestamp": utc_now(),
                        "tileId": tile.id,
                        "kind": "substation-overpass",
                        "depth": tile.depth,
                        "parent": tile.parent,
                    }
                )
            print(
                f"country={tile.country} overpass_tiles={index}/{len(tiles)} raw_substations={sum(item.raw_count for item in results)} "
                f"failed_tiles={len(failures)}",
                flush=True,
            )
    return results, failures


def fetch_overpass_substations(
    country: str,
    boundary,
    *,
    checkpoint_dir: Path,
    chunk_size: float,
    timeout: float,
    max_retries: int,
    max_split_depth: int,
    workers: int,
    resume: bool,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    all_tiles = _tiles(country, boundary, min(chunk_size, 1.5))
    run_tiles = []
    resumed_subtiles: list[OverpassResult] = []
    resolved_children: list[Tile] = []
    for tile in list(all_tiles):
        expected_children = [child for child in split_tile(tile) if box(*child.bbox).intersects(boundary)]
        loaded_children = [_load(checkpoint_dir, child) for child in expected_children] if resume else []
        if resume and _load(checkpoint_dir, tile) is None and expected_children and all(loaded_children):
            resumed_subtiles.extend(loaded_children)
            resolved_children.extend(expected_children)
        else:
            run_tiles.append(tile)
    all_tiles.extend(resolved_children)
    results, failures = _run(
        run_tiles,
        checkpoint_dir=checkpoint_dir,
        resume=resume,
        timeout=timeout,
        max_retries=max_retries,
        workers=min(workers, 4),
    )
    results.extend(resumed_subtiles)
    for _depth in range(max_split_depth):
        if not failures:
            break
        by_id = {tile.id: tile for tile in all_tiles}
        children = [
            child
            for failure in failures
            for child in split_tile(by_id[failure["tileId"]])
            if box(*child.bbox).intersects(boundary)
        ]
        retry_results, failures = _run(
            children,
            checkpoint_dir=checkpoint_dir,
            resume=resume,
            timeout=timeout,
            max_retries=max_retries,
            workers=min(workers, 4),
        )
        results.extend(retry_results)
        all_tiles.extend(children)

    unique: dict[str, dict[str, Any]] = {}
    rejected = 0
    for result in results:
        for feature in result.features:
            normalized, _reason = normalize_downloaded_feature(country, feature, boundary)
            if normalized is None:
                rejected += 1
                continue
            key = feature_key(country, normalized)
            unique[key] = choose_preferred_feature(unique[key], normalized) if key in unique else normalized
    features = sorted(unique.values(), key=lambda item: feature_key(country, item))
    diagnostics = {
        "provider": OVERPASS_PROVIDER,
        "processedTiles": len(results),
        "failedRequests": len(failures),
        "failedTiles": failures,
        "partial": bool(failures),
        "rawFeatureCount": sum(result.raw_count for result in results),
        "uniqueFeatureCount": len(features),
        "rejectedFeatureCount": rejected,
    }
    return features, diagnostics
