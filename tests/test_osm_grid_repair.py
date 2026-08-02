import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests
from shapely.geometry import LineString, Point, Polygon, mapping


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_osm_download"))

import compare_grid_datasets as compare  # noqa: E402
import osm_grid_common as common  # noqa: E402
import overpass_substations as overpass  # noqa: E402


def raw_feature(power, voltage, geometry, osm_id="1", **properties):
    return {
        "type": "Feature",
        "properties": {
            "OBJECTID": int(osm_id) if str(osm_id).isdigit() else 1,
            "osm_id": osm_id,
            "osm_id2": str(osm_id),
            "power": power,
            "voltage": voltage,
            **properties,
        },
        "geometry": mapping(geometry),
    }


class VoltageTests(unittest.TestCase):
    def test_raw_osm_voltage_is_always_volts(self):
        cases = {
            "400": [0.4],
            "20000": [20],
            "63000": [63],
            "132000": [132],
            "225000": [225],
            "300000": [300],
            "400000": [400],
            "550000": [550],
            "20000;400": [0.4, 20],
            "400000;225000": [225, 400],
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(common.parse_osm_voltage_kv(raw), expected)

    def test_exact_class_boundaries(self):
        cases = {
            0.4: None,
            20: None,
            50: "154",
            63: "154",
            132: "154",
            225: "154",
            299.999: "154",
            300: "400",
            400: "400",
            550: "400",
            551: None,
        }
        for voltage, expected in cases.items():
            with self.subTest(voltage=voltage):
                self.assertEqual(common.voltage_class(voltage), expected)

    def test_raw_voltage_overrides_stale_derived_kv(self):
        props = {"voltage": "400", "voltageRaw": "400", "voltageMaxKv": 400, "voltagesKv": [400]}
        self.assertEqual(common.parse_feature_voltages_kv(props), [0.4])


class BoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.es = common.load_boundary(ROOT / "data/countries/ES/boundary.geojson")
        cls.fr = common.load_boundary(ROOT / "data/countries/FR/boundary.geojson")
        cls.pt = common.load_boundary(ROOT / "data/countries/PT/boundary.geojson")
        cls.it = common.load_boundary(ROOT / "data/countries/IT/boundary.geojson")

    def accepted(self, country, boundary, point):
        feature = raw_feature("substation", "225000", Point(*point))
        return common.normalize_downloaded_feature(country, feature, boundary)[0] is not None

    def test_cross_country_points_are_rejected(self):
        self.assertFalse(self.accepted("ES", self.es, (2.35, 48.86)))
        self.assertFalse(self.accepted("FR", self.fr, (-3.70, 40.42)))

    def test_balear_and_corsica_are_accepted_canary_is_rejected(self):
        self.assertTrue(self.accepted("ES", self.es, (2.65, 39.57)))
        self.assertTrue(self.accepted("FR", self.fr, (9.1, 42.15)))
        self.assertFalse(self.accepted("ES", self.es, (-15.43, 28.12)))

    def test_cross_border_line_intersection_is_accepted(self):
        feature = raw_feature("line", "225000", LineString([(-1.0, 42.5), (0.2, 43.2)]))
        normalized, reason = common.normalize_downloaded_feature("ES", feature, self.es)
        self.assertEqual(reason, "accepted")
        self.assertIsNotNone(normalized)

    def test_polygon_substation_supported(self):
        polygon = Polygon([(-3.71, 40.41), (-3.69, 40.41), (-3.69, 40.43), (-3.71, 40.43)])
        feature = raw_feature("substation", "400000;225000", polygon)
        normalized, _ = common.normalize_downloaded_feature("ES", feature, self.es)
        self.assertEqual(normalized["properties"]["actualVoltagesKv"], [225, 400])

    def test_portugal_mainland_scope(self):
        self.assertTrue(self.accepted("PT", self.pt, (-9.14, 38.72)))
        self.assertTrue(self.accepted("PT", self.pt, (-8.61, 41.15)))
        self.assertFalse(self.accepted("PT", self.pt, (-3.70, 40.42)))
        self.assertFalse(self.accepted("PT", self.pt, (-25.67, 37.74)))
        self.assertFalse(self.accepted("PT", self.pt, (-16.92, 32.65)))

    def test_italy_scope_and_independent_states(self):
        self.assertTrue(self.accepted("IT", self.it, (14.0, 37.5)))
        self.assertTrue(self.accepted("IT", self.it, (9.0, 40.0)))
        self.assertFalse(self.accepted("IT", self.it, (9.1, 42.15)))
        self.assertFalse(self.accepted("IT", self.it, (12.4578, 43.9424)))
        self.assertFalse(self.accepted("IT", self.it, (12.4534, 41.9029)))

    def test_pt_it_cross_border_features_are_rejected(self):
        self.assertFalse(self.accepted("PT", self.pt, (12.5, 42.5)))
        self.assertFalse(self.accepted("IT", self.it, (-8.0, 39.6)))


class FakeResponse:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)

    def get(self, *_args, **_kwargs):
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        pass


class DownloadTests(unittest.TestCase):
    def test_osm_country_registry_and_new_wrappers(self):
        self.assertEqual(common.OSM_COUNTRY_CODES, frozenset({"ES", "FR", "PT", "IT"}))
        for filename, code in (("fetch_portugal_osm_full.py", '"PT"'), ("fetch_italy_osm_full.py", '"IT"')):
            text = (ROOT / "py_osm_download" / filename).read_text(encoding="utf-8")
            self.assertIn("build_cli_parser", text)
            self.assertIn("run_download", text)
            self.assertIn(code, text)

    def _retry_case(self, first):
        client = common.ArcGISClient(timeout=1, max_retries=2, backoff=0)
        client.session = FakeSession([first, FakeResponse(200, {"ok": True})])
        client.reset_session = lambda: None
        payload, attempts = client.get_json("https://example.test", {})
        self.assertTrue(payload["ok"])
        self.assertEqual(attempts, 2)

    def test_429_500_and_timeout_retry(self):
        for first in (FakeResponse(429), FakeResponse(500), requests.Timeout("slow")):
            with self.subTest(first=type(first).__name__):
                self._retry_case(first)

    def test_failed_tile_splits_into_four(self):
        tile = common.Tile("ES", "line", (0, 0, 2, 2))
        children = common.split_tile(tile)
        self.assertEqual(len(children), 4)
        self.assertTrue(all(child.depth == 1 and child.parent == tile.id for child in children))

    def test_pagination_until_short_page(self):
        feature = raw_feature("line", "225000", LineString([(0, 0), (1, 1)]))

        class Client:
            def __init__(self):
                self.calls = 0

            def get_json(self, _endpoint, _params):
                self.calls += 1
                return ({"features": [feature, feature]} if self.calls == 1 else {"features": [feature]}), 1

        client = Client()
        result = common.fetch_tile(client, "endpoint", common.Tile("ES", "line", (0, 0, 1, 1)), "1=1", page_size=2)
        self.assertEqual(result.raw_count, 3)
        self.assertEqual(result.page_count, 2)

    def test_resume_checkpoint_and_atomic_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            tile = common.Tile("FR", "line", (0, 0, 1, 1))
            result = common.TileResult(tile=tile, features=[], raw_count=0, page_count=1, attempts=1)
            common.save_checkpoint(directory, result)
            loaded = common.load_checkpoint(directory, tile)
            self.assertEqual(loaded.page_count, 1)
            target = directory / "atomic.json"
            common.atomic_json_write(target, {"partial": False})
            self.assertEqual(json.loads(target.read_text()), {"partial": False})
            self.assertEqual(list(directory.glob("*.tmp")), [])

    def test_deterministic_duplicate_prefers_newer_richer_feature(self):
        old = raw_feature("line", "225000", LineString([(0, 0), (0.5, 0.5)]), osm_id="8", osm_timestamp="2024-01-01T00:00:00Z", osm_version=1)
        new = raw_feature(
            "line", "225000", LineString([(0, 0), (0.5, 0.5), (1, 1)]), osm_id="8",
            osm_timestamp="2025-01-01T00:00:00Z", osm_version=2, name="Real name", operator="RTE",
        )
        selected = common.choose_preferred_feature(old, new)
        self.assertEqual(selected["properties"]["name"], "Real name")
        self.assertEqual(selected["geometry"]["type"], "LineString")
        self.assertEqual(len(selected["geometry"]["coordinates"]), 3, "old revision geometry is not unioned")

    def test_overpass_node_and_polygon_way_preserve_osm_identity_and_provenance(self):
        node = {
            "type": "node", "id": 10, "lat": 40.0, "lon": -3.0, "timestamp": "2026-01-01T00:00:00Z",
            "tags": {"power": "substation", "voltage": "225000", "operator": "REE"},
        }
        way = {
            "type": "way", "id": 11, "timestamp": "2026-01-02T00:00:00Z",
            "tags": {"power": "substation", "voltage": "400000;225000", "name": "Real substation"},
            "geometry": [
                {"lon": -3.1, "lat": 40.0}, {"lon": -3.0, "lat": 40.0},
                {"lon": -3.0, "lat": 40.1}, {"lon": -3.1, "lat": 40.1},
                {"lon": -3.1, "lat": 40.0},
            ],
        }
        node_feature = overpass.element_to_feature(node)
        way_feature = overpass.element_to_feature(way)
        self.assertEqual(node_feature["geometry"]["type"], "Point")
        self.assertEqual(way_feature["geometry"]["type"], "Polygon")
        self.assertEqual(way_feature["properties"]["osmType"], "way")
        self.assertEqual(way_feature["properties"]["sourceProvider"], "OpenStreetMap Overpass API")
        self.assertIn("ArcGIS", way_feature["properties"]["sourceFallback"])


class ComparisonTests(unittest.TestCase):
    def test_high_count_does_not_beat_production_gates_and_fresh_wins(self):
        boundary = {"type": "Feature", "properties": {}, "geometry": mapping(Polygon([(0, 0), (2, 0), (2, 2), (0, 2)]))}
        good = raw_feature("line", "225000", LineString([(0.1, 0.1), (1.0, 1.0)]), osm_id="1", name="L1")
        bad = raw_feature("line", "400", LineString([(0.2, 0.2), (1.1, 1.1)]), osm_id="2", actualVoltageKv=400)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boundary_path = root / "boundary.geojson"
            existing_path = root / "existing.geojson"
            fresh_path = root / "fresh.geojson"
            boundary_path.write_text(json.dumps(boundary), encoding="utf-8")
            existing_path.write_text(json.dumps({"type": "FeatureCollection", "metadata": {}, "features": [good, bad] * 3}), encoding="utf-8")
            fresh_path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "metadata": {"downloadDiagnostics": {"partial": False, "failedRequests": 0, "failedTiles": [], "suspectedGapTileCount": 0}},
                        "features": [good],
                    }
                ),
                encoding="utf-8",
            )
            report, _ = compare.compare(existing_path, fresh_path, boundary_path, "ES")
            self.assertEqual(report["selection"]["selected"], "fresh")
            self.assertFalse(report["existing"]["productionGatesPassed"])
            self.assertTrue(report["fresh"]["productionGatesPassed"])

    def test_partial_manifest_never_passes_production_gates(self):
        boundary = Polygon([(0, 0), (2, 0), (2, 2), (0, 2)])
        feature = raw_feature("line", "225000", LineString([(0.1, 0.1), (1.0, 1.0)]), osm_id="1")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "partial.geojson"
            path.write_text(json.dumps({
                "type": "FeatureCollection",
                "metadata": {"downloadDiagnostics": {
                    "partial": True,
                    "failedRequests": 1,
                    "failedTiles": [{"bbox": [0, 0, 1, 1], "lastError": "timeout"}],
                }},
                "features": [feature],
            }), encoding="utf-8")
            metrics, _ = compare.analyze_dataset(path, "ES", boundary)
            self.assertFalse(metrics["productionGatesPassed"])
            self.assertEqual(metrics["failedRequests"], 1)

    def test_explicitly_verified_legacy_only_feature_can_be_preserved(self):
        fresh = raw_feature("line", "225000", LineString([(0, 0), (1, 1)]), osm_id="1")
        legacy = raw_feature("cable", "400000", LineString([(0, 1), (1, 0)]), osm_id="2")
        fresh_key = common.feature_key("ES", fresh)
        legacy_key = common.feature_key("ES", legacy)
        combined = compare.build_validated_union(
            {legacy_key: legacy}, {fresh_key: fresh}, {legacy_key}
        )
        self.assertEqual(set(combined), {fresh_key, legacy_key})
        self.assertEqual(combined[legacy_key]["properties"]["sourceFallback"], "legacy-validated")

    def test_new_country_source_validation_selects_complete_union(self):
        boundary = {"type": "Feature", "properties": {}, "geometry": mapping(Polygon([(0, 0), (2, 0), (2, 2), (0, 2)]))}
        line = raw_feature("line", "225000", LineString([(0.1, 0.1), (1, 1)]), osm_id="1", sourceProvider="ArcGIS OSM Europe")
        sub = raw_feature("substation", "400000", Point(0.5, 0.5), osm_id="2", sourceProvider="OpenStreetMap Overpass API")
        diagnostics = {
            "partial": False,
            "failedRequests": 0,
            "failedTiles": [],
            "suspectedGapTileCount": 0,
            "overpassFallback": {"partial": False, "failedRequests": 0, "failedTiles": [], "suspectedGapTileCount": 0},
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boundary_path = root / "boundary.geojson"
            fresh_path = root / "fresh.geojson"
            boundary_path.write_text(json.dumps(boundary), encoding="utf-8")
            fresh_path.write_text(json.dumps({
                "type": "FeatureCollection",
                "metadata": {"downloadDiagnostics": diagnostics},
                "features": [line, sub],
            }), encoding="utf-8")
            report, selected = compare.compare_source_validation(fresh_path, boundary_path, "PT")
            self.assertEqual(report["selection"]["selected"], "validated-union")
            self.assertTrue(report["validatedUnion"]["used"])
            self.assertEqual(report["sourceCandidates"]["arcgisFresh"]["validLineCount"], 1)
            self.assertEqual(report["sourceCandidates"]["overpassCompletion"]["validSubstationCount"], 1)
            self.assertEqual(len(selected["features"]), 2)


if __name__ == "__main__":
    unittest.main()
