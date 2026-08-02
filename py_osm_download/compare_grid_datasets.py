#!/usr/bin/env python3
"""Compare existing and freshly downloaded OSM grid datasets."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from shapely.geometry import shape

from osm_grid_common import (
    LINE_TYPES,
    OSM_COUNTRY_CODES,
    atomic_json_write,
    choose_preferred_feature,
    extract_positive_numeric_tokens,
    feature_key,
    load_boundary,
    normalize_downloaded_feature,
    parse_feature_voltages_kv,
    utc_now,
    valid_geojson_geometry,
    voltage_class,
)


def _metadata_partial(metadata: dict[str, Any]) -> tuple[bool | None, int | None]:
    diagnostics = metadata.get("downloadDiagnostics") or {}
    partial = diagnostics.get("partial", metadata.get("partial"))
    failed = diagnostics.get("failedRequests", metadata.get("failedRequests"))
    return (bool(partial) if partial is not None else None, int(failed) if failed is not None else None)


def _alternative_summary(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "path": str(path),
        "featureCount": int(data.get("featureCount") or 0),
        "counts": data.get("counts") or {},
        "complete": bool(data.get("complete")),
        "reason": data.get("reason"),
        "productionEligible": False,
        "decision": "Eksik AC hat katmanı nedeniyle ana production kaynağı olarak kullanılmadı; yalnız ikincil doğrulama adayıdır.",
    }


def _line_endpoints(geometry: dict[str, Any]) -> list[tuple[float, float]]:
    if geometry.get("type") == "LineString":
        lines = [geometry.get("coordinates") or []]
    elif geometry.get("type") == "MultiLineString":
        lines = geometry.get("coordinates") or []
    else:
        return []
    endpoints = []
    for line in lines:
        if len(line) >= 2:
            endpoints.extend(
                [
                    (round(float(line[0][0]), 4), round(float(line[0][1]), 4)),
                    (round(float(line[-1][0]), 4), round(float(line[-1][1]), 4)),
                ]
            )
    return endpoints


def analyze_collection(
    data: dict[str, Any],
    country: str,
    boundary,
    *,
    path_label: str,
    file_size_bytes: int,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metadata = data.get("metadata") or {}
    partial, failed_requests = _metadata_partial(metadata)
    counts = Counter()
    endpoints = Counter()
    accepted: dict[str, dict[str, Any]] = {}
    line_properties: list[dict[str, Any]] = []
    seen: set[str] = set()

    for raw_feature in data.get("features") or []:
        counts["rawFeatureCount"] += 1
        geometry = raw_feature.get("geometry")
        properties = raw_feature.get("properties") or {}
        if not valid_geojson_geometry(geometry):
            counts["invalidGeometryCount"] += 1
            continue
        if not shape(geometry).intersects(boundary):
            counts["outsideBoundaryCount"] += 1
            continue
        raw_voltage_present = any(properties.get(key) not in (None, "") for key in ("voltage", "voltageRaw"))
        parsed = parse_feature_voltages_kv(properties)
        if not parsed:
            counts["voltageParseFailureCount"] += 1
        if raw_voltage_present:
            derived_values = []
            for key in ("actualVoltagesKv", "voltagesKv", "actualVoltageKv", "voltageMaxKv"):
                derived_values.extend(extract_positive_numeric_tokens(properties.get(key)))
            if derived_values and (not parsed or abs(max(derived_values) - max(parsed)) > 1e-9):
                counts["voltageFieldMismatchCount"] += 1
        normalized, reason = normalize_downloaded_feature(country, raw_feature, boundary)
        if normalized is None:
            counts[f"rejected:{reason}"] += 1
            continue
        key = feature_key(country, normalized)
        if key in seen:
            counts["duplicateCount"] += 1
            accepted[key] = choose_preferred_feature(accepted[key], normalized)
            continue
        seen.add(key)
        accepted[key] = normalized
        clean = normalized["properties"]
        power = clean["elementType"]
        if power in LINE_TYPES:
            counts["validLineCount"] += 1
            counts[f"grid{voltage_class(clean['actualVoltageKv'])}Count"] += 1
            line_properties.append(properties)
            endpoints.update(_line_endpoints(geometry))
        else:
            counts["validSubstationCount"] += 1
        if properties.get("osm_timestamp") or properties.get("osmTimestamp"):
            counts["osmTimestampCount"] += 1

    valid_line_count = counts["validLineCount"]
    named = sum(bool(item.get("name")) for item in line_properties)
    referenced = sum(bool(item.get("ref")) for item in line_properties)
    operated = sum(bool(item.get("operator")) for item in line_properties)
    endpoint_count = sum(endpoints.values())
    dangling = sum(value == 1 for value in endpoints.values())
    diagnostics = metadata.get("downloadDiagnostics") or {}
    transparency = partial is not None and failed_requests is not None and isinstance(diagnostics.get("failedTiles", []), list)
    metrics = {
        "path": path_label,
        "fileSizeBytes": file_size_bytes,
        "sourceTimestamp": metadata.get("downloadedAt") or metadata.get("exportedAt"),
        "sourceProviders": metadata.get("sourceProviders") or [metadata.get("source")],
        "partial": partial,
        "failedRequests": failed_requests,
        "downloadTransparency": transparency,
        "rawFeatureCount": counts["rawFeatureCount"],
        "validLineCount": valid_line_count,
        "validSubstationCount": counts["validSubstationCount"],
        "grid400LineCount": counts["grid400Count"],
        "grid154LineCount": counts["grid154Count"],
        "outsideBoundaryCount": counts["outsideBoundaryCount"],
        "invalidGeometryCount": counts["invalidGeometryCount"],
        "duplicateCount": counts["duplicateCount"],
        "voltageParseFailureCount": counts["voltageParseFailureCount"],
        "voltageFieldMismatchCount": counts["voltageFieldMismatchCount"],
        "nameLineCount": named,
        "refLineCount": referenced,
        "operatorLineCount": operated,
        "nameLineRatio": round(named / valid_line_count, 6) if valid_line_count else 0,
        "refLineRatio": round(referenced / valid_line_count, 6) if valid_line_count else 0,
        "operatorLineRatio": round(operated / valid_line_count, 6) if valid_line_count else 0,
        "voltageParseSuccessRatio": round((len(accepted) - counts["voltageParseFailureCount"]) / counts["rawFeatureCount"], 6) if counts["rawFeatureCount"] else 0,
        "osmTimestampCoverageRatio": round(counts["osmTimestampCount"] / counts["rawFeatureCount"], 6) if counts["rawFeatureCount"] else 0,
        "suspectedGapTileCount": int(diagnostics.get("suspectedGapTileCount") or 0),
        "exceededTransferLimitTileCount": int(diagnostics.get("exceededTransferLimitTileCount") or 0),
        "danglingEndpointCount": dangling,
        "danglingEndpointRatio": round(dangling / endpoint_count, 6) if endpoint_count else 0,
    }
    metrics["productionGatesPassed"] = bool(
        partial is False
        and failed_requests == 0
        and transparency
        and metrics["outsideBoundaryCount"] == 0
        and metrics["invalidGeometryCount"] == 0
        and metrics["duplicateCount"] == 0
        and metrics["voltageFieldMismatchCount"] == 0
        and metrics["suspectedGapTileCount"] == 0
    )
    return metrics, accepted


def analyze_dataset(path: Path, country: str, boundary) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return analyze_collection(
        data,
        country,
        boundary,
        path_label=str(path),
        file_size_bytes=path.stat().st_size,
    )


def _markdown(report: dict[str, Any]) -> str:
    new_country = report.get("comparisonMode") == "source-validation"
    left_label, right_label = ("ArcGIS fresh", "Validated union") if new_country else ("Mevcut", "Yeni")
    lines = [
        f"# {report['country']} OSM şebeke veri karşılaştırması",
        "",
        f"Oluşturulma: `{report['generatedAt']}`",
        "",
        f"| Metrik | {left_label} | {right_label} |",
        "|---|---:|---:|",
    ]
    existing, fresh = report["existing"], report["fresh"]
    keys = (
        "fileSizeBytes", "rawFeatureCount", "validLineCount", "validSubstationCount",
        "grid400LineCount", "grid154LineCount", "outsideBoundaryCount",
        "invalidGeometryCount", "duplicateCount", "voltageParseFailureCount",
        "voltageFieldMismatchCount", "nameLineCount", "refLineCount",
        "operatorLineCount", "osmTimestampCoverageRatio", "suspectedGapTileCount",
        "danglingEndpointRatio", "failedRequests", "partial", "productionGatesPassed",
    )
    for key in keys:
        lines.append(f"| {key} | {existing.get(key)} | {fresh.get(key)} |")
    if new_country:
        overpass = report["sourceCandidates"]["overpassCompletion"]
        lines.extend(
            [
                "",
                "## Overpass doğrulama ve tamamlama",
                "",
                f"Ham feature: `{overpass['rawFeatureCount']}` · geçerli TM: `{overpass['validSubstationCount']}` · "
                f"failed requests: `{overpass['failedRequests']}` · partial: `{str(overpass['partial']).lower()}`.",
                "",
                "Overpass ülkenin tamamını tek sorguyla çekmek için değil, ArcGIS Structures katmanının atladığı "
                "polygon/way trafo merkezlerini küçük tile'larla doğrulamak ve tamamlamak için kullanıldı.",
            ]
        )
    lines.extend(
        [
            "",
            "## Seçim",
            "",
            f"Seçilen dosya: `{report['selection']['selected']}`",
            "",
            report["selection"]["reason"],
            "",
            "## Validated union",
            "",
            report["validatedUnion"]["reason"],
            "",
        ]
    )
    alternative = report.get("alternativeCandidate")
    if alternative:
        lines.extend(
            [
                "## Önceki alternatif İspanya adayı",
                "",
                f"Feature: `{alternative['featureCount']}` · complete: `{str(alternative['complete']).lower()}` · "
                f"dağılım: `{json.dumps(alternative['counts'], ensure_ascii=False)}`",
                "",
                alternative["decision"],
                "",
            ]
        )
    lines.extend(["## Kaynak boşluk analizi" if new_country else "## Önceki boşluk koordinatları", ""])
    if report["gapAnalysis"]["candidateTiles"]:
        lines.extend(["| Merkez | Mevcut hat | Yeni hat | Fark |", "|---|---:|---:|---:|"])
        for tile in report["gapAnalysis"]["candidateTiles"]:
            lines.append(
                f"| {tile['center'][1]:.4f}, {tile['center'][0]:.4f} | {tile['existingLineCount']} | "
                f"{tile['freshLineCount']} | {tile['delta']} |"
            )
    else:
        lines.append(
            "ArcGIS hat katmanı ile validated union arasında belirgin 1° hat boşluğu bulunmadı; Overpass katkısı TM tamamlamasıdır."
            if new_country
            else "Mevcut veride sıfır/çok düşük yoğunluk gösterip yeni veride belirgin biçimde dolan 1° tile bulunmadı."
        )
    if new_country:
        lines.extend(["", "## Coğrafi kapsam kontrolleri", "", "| Bölge | Hat | TM |", "|---|---:|---:|"])
        for check in report.get("coverageChecks") or []:
            lines.append(f"| {check['name']} | {check['lineCount']} | {check['substationCount']} |")
        runtime = report.get("runtimeSize")
        if runtime:
            lines.extend(
                [
                    "",
                    "## Runtime dağıtım boyutu",
                    "",
                    f"Ham: `{runtime['bytes']}` bayt · gzip: `{runtime['gzipBytes']}` bayt · "
                    f"Brotli: `{runtime['brotliBytes']}` bayt.",
                ]
            )
    lines.append("")
    return "\n".join(lines)


def _line_density(features: dict[str, dict[str, Any]]) -> Counter:
    density = Counter()
    for feature in features.values():
        properties = feature.get("properties") or {}
        if str(properties.get("power") or properties.get("elementType") or "").lower() not in LINE_TYPES:
            continue
        center = shape(feature["geometry"]).representative_point()
        density[(int(center.x // 1), int(center.y // 1))] += 1
    return density


def _coverage_checks(features: dict[str, dict[str, Any]], country: str) -> list[dict[str, Any]]:
    regions = {
        "PT": [
            ("Kuzey iletim koridoru", (-9.5, 40.5, -7.0, 42.2)),
            ("Porto çevresi", (-8.9, 40.8, -8.1, 41.6)),
            ("Lizbon çevresi", (-9.5, 38.3, -8.5, 39.2)),
        ],
        "IT": [
            ("Kuzey İtalya", (6.6, 44.0, 13.8, 47.2)),
            ("Orta ve Güney İtalya", (10.0, 36.5, 18.6, 44.0)),
            ("Sicilya", (12.3, 36.5, 15.8, 38.6)),
            ("Sardinya", (8.0, 38.8, 9.9, 41.4)),
        ],
    }
    checks = []
    for name, bounds in regions.get(country, []):
        region = shape({
            "type": "Polygon",
            "coordinates": [[
                [bounds[0], bounds[1]], [bounds[2], bounds[1]],
                [bounds[2], bounds[3]], [bounds[0], bounds[3]],
                [bounds[0], bounds[1]],
            ]],
        })
        lines = substations = 0
        for feature in features.values():
            geometry = shape(feature["geometry"])
            if not geometry.intersects(region):
                continue
            power = str((feature.get("properties") or {}).get("power") or "").lower()
            if power in LINE_TYPES:
                lines += 1
            elif power == "substation":
                substations += 1
        checks.append({"name": name, "bbox": list(bounds), "lineCount": lines, "substationCount": substations})
    return checks


def _runtime_size(country: str) -> dict[str, int] | None:
    path = Path(__file__).resolve().parents[1] / "reports" / "runtime_sizes.json"
    if not path.exists():
        return None
    return (json.loads(path.read_text(encoding="utf-8")).get("countries") or {}).get(country, {}).get("totals")


def _gap_candidates(existing_features: dict[str, dict[str, Any]], fresh_features: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    existing_density = _line_density(existing_features)
    fresh_density = _line_density(fresh_features)
    candidates = []
    for tile in set(existing_density) | set(fresh_density):
        old, new = existing_density[tile], fresh_density[tile]
        if new < 5 or not (old == 0 or (new >= old + 10 and new >= old * 1.5)):
            continue
        west, south = tile
        candidates.append(
            {
                "bbox": [west, south, west + 1, south + 1],
                "center": [west + 0.5, south + 0.5],
                "existingLineCount": old,
                "freshLineCount": new,
                "delta": new - old,
            }
        )
    return sorted(candidates, key=lambda item: (-item["delta"], item["center"]))[:20]


def build_validated_union(
    existing_features: dict[str, dict[str, Any]],
    fresh_features: dict[str, dict[str, Any]],
    verified_legacy_keys: set[str],
) -> dict[str, dict[str, Any]]:
    """Merge only explicitly verified legacy-only features into a fresh set."""

    combined = dict(fresh_features)
    for key in sorted(verified_legacy_keys):
        if key not in existing_features or key in combined:
            continue
        feature = existing_features[key]
        properties = dict(feature.get("properties") or {})
        properties["sourceFallback"] = "legacy-validated"
        combined[key] = {**feature, "properties": properties}
    return combined


def compare(
    existing_path: Path,
    fresh_path: Path,
    boundary_path: Path,
    country: str,
    alternative_manifest_path: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    boundary = load_boundary(boundary_path)
    existing_metrics, existing_features = analyze_dataset(existing_path, country, boundary)
    fresh_metrics, fresh_features = analyze_dataset(fresh_path, country, boundary)
    if fresh_metrics["productionGatesPassed"]:
        selected = "fresh"
        reason = (
            "Yeni indirme ülke sınırı, ham OSM voltage birimi, geometri, başarısız tile şeffaflığı "
            "ve deterministik deduplication production kapılarının tamamını geçti."
        )
    elif existing_metrics["productionGatesPassed"]:
        selected = "existing"
        reason = "Yeni indirme production kapılarını geçemedi; doğrulanmış mevcut veri korundu."
    else:
        selected = "none"
        reason = "İki adaydan hiçbiri production kapılarının tamamını geçmedi."

    legacy_only = set(existing_features) - set(fresh_features)
    fresh_only = set(fresh_features) - set(existing_features)
    shared = set(existing_features) & set(fresh_features)
    use_union = False
    union_reason = (
        f"Birleşim adayı ölçüldü: {len(shared)} ortak, {len(fresh_only)} yalnız yeni, "
        f"{len(legacy_only)} yalnız eski feature. Yeni indirme tam ve şüpheli gap içermediği için "
        "silinmiş/değişmiş olabilecek eski OSM feature'ları production'a geri eklenmedi; fresh veri seçildi."
        if selected == "fresh"
        else "Tam bir yeni indirme bulunmadığından otomatik validated union production'a alınmadı."
    )
    report = {
        "country": country,
        "generatedAt": utc_now(),
        "existing": existing_metrics,
        "fresh": fresh_metrics,
        "selection": {"selected": selected, "reason": reason},
        "validatedUnion": {
            "used": use_union,
            "sharedFeatureCount": len(shared),
            "freshOnlyFeatureCount": len(fresh_only),
            "legacyOnlyFeatureCount": len(legacy_only),
            "reason": union_reason,
        },
        "alternativeCandidate": _alternative_summary(alternative_manifest_path),
        "gapAnalysis": {
            "tileSizeDegrees": 1,
            "method": "Accepted line representative points; fresh >= 5 and existing zero or fresh >= existing + 10 and >= 1.5x",
            "candidateTiles": _gap_candidates(existing_features, fresh_features),
        },
    }
    selected_data = json.loads((fresh_path if selected == "fresh" else existing_path).read_text(encoding="utf-8")) if selected != "none" else {}
    return report, selected_data


def _provider_collection(data: dict[str, Any], provider_fragment: str, diagnostics: dict[str, Any]) -> dict[str, Any]:
    features = [
        feature
        for feature in data.get("features") or []
        if provider_fragment.lower() in str((feature.get("properties") or {}).get("sourceProvider") or "").lower()
    ]
    metadata = dict(data.get("metadata") or {})
    metadata["sourceProviders"] = [provider_fragment]
    metadata["downloadDiagnostics"] = diagnostics
    return {"type": "FeatureCollection", "metadata": metadata, "features": features}


def compare_source_validation(
    fresh_path: Path,
    boundary_path: Path,
    country: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    boundary = load_boundary(boundary_path)
    data = json.loads(fresh_path.read_text(encoding="utf-8"))
    diagnostics = (data.get("metadata") or {}).get("downloadDiagnostics") or {}
    arcgis_diagnostics = {
        key: value
        for key, value in diagnostics.items()
        if key != "overpassFallback"
    }
    overpass_diagnostics = diagnostics.get("overpassFallback") or {}
    arcgis_data = _provider_collection(data, "ArcGIS OSM Europe", arcgis_diagnostics)
    overpass_data = _provider_collection(data, "OpenStreetMap Overpass API", overpass_diagnostics)
    encoded_arcgis = json.dumps(arcgis_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded_overpass = json.dumps(overpass_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    arcgis_metrics, arcgis_features = analyze_collection(
        arcgis_data,
        country,
        boundary,
        path_label=f"{fresh_path}#ArcGIS",
        file_size_bytes=len(encoded_arcgis),
    )
    overpass_metrics, overpass_features = analyze_collection(
        overpass_data,
        country,
        boundary,
        path_label=f"{fresh_path}#Overpass",
        file_size_bytes=len(encoded_overpass),
    )
    union_metrics, union_features = analyze_dataset(fresh_path, country, boundary)
    selected = "validated-union" if union_metrics["productionGatesPassed"] else "none"
    reason = (
        "ArcGIS hat/nokta verisi ile küçük tile'lı Overpass polygon/way TM tamamlamasının OSM kimliği ve türü "
        "üzerinden tekilleştirilmiş birleşimi bütün production kapılarını geçti."
        if selected != "none"
        else "Validated union production kapılarının tamamını geçemedi."
    )
    report = {
        "country": country,
        "generatedAt": utc_now(),
        "comparisonMode": "source-validation",
        "existing": arcgis_metrics,
        "fresh": union_metrics,
        "sourceCandidates": {
            "arcgisFresh": arcgis_metrics,
            "overpassCompletion": overpass_metrics,
        },
        "selection": {"selected": selected, "reason": reason},
        "validatedUnion": {
            "used": selected == "validated-union",
            "sharedFeatureCount": len(set(arcgis_features) & set(overpass_features)),
            "arcgisOnlyFeatureCount": len(set(arcgis_features) - set(overpass_features)),
            "overpassOnlyFeatureCount": len(set(overpass_features) - set(arcgis_features)),
            "unionFeatureCount": len(union_features),
            "reason": reason,
        },
        "alternativeCandidate": None,
        "gapAnalysis": {
            "tileSizeDegrees": 1,
            "method": "ArcGIS accepted line representative points compared with validated union",
            "candidateTiles": _gap_candidates(arcgis_features, union_features),
        },
        "coverageChecks": _coverage_checks(union_features, country),
        "runtimeSize": _runtime_size(country),
    }
    return report, data if selected != "none" else {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", required=True, choices=sorted(OSM_COUNTRY_CODES))
    parser.add_argument("--existing")
    parser.add_argument("--fresh", required=True)
    parser.add_argument("--boundary", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--selected-output")
    parser.add_argument("--alternative-manifest")
    args = parser.parse_args()
    report_path = Path(args.report).resolve()
    if args.existing:
        report, selected = compare(
            Path(args.existing).resolve(),
            Path(args.fresh).resolve(),
            Path(args.boundary).resolve(),
            args.country,
            Path(args.alternative_manifest).resolve() if args.alternative_manifest else None,
        )
    else:
        if args.country not in {"PT", "IT"}:
            parser.error("--existing is required for ES/FR comparisons")
        report, selected = compare_source_validation(
            Path(args.fresh).resolve(),
            Path(args.boundary).resolve(),
            args.country,
        )
    atomic_json_write(report_path, report, compact=False)
    report_path.with_suffix(".md").write_text(_markdown(report), encoding="utf-8")
    if args.selected_output:
        if report["selection"]["selected"] == "none":
            raise RuntimeError("No dataset passed production gates")
        atomic_json_write(Path(args.selected_output).resolve(), selected)
    print(json.dumps(report["selection"], ensure_ascii=False, indent=2))
    return 0 if report["selection"]["selected"] != "none" else 2


if __name__ == "__main__":
    raise SystemExit(main())
