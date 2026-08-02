import importlib.util
import json
import unittest
from pathlib import Path

from shapely.geometry import Polygon, mapping


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "build_country_grid.py"
SPEC = importlib.util.spec_from_file_location("build_country_grid", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class VoltageNormalizationTests(unittest.TestCase):
    def test_voltage_boundaries(self):
        cases = (
            (49, None),
            (50, "154"),
            (225, "154"),
            (299.999, "154"),
            (300, "400"),
            (400, "400"),
            (550, "400"),
            (551, None),
        )
        for voltage, expected in cases:
            with self.subTest(voltage=voltage):
                self.assertEqual(MODULE.voltage_class(voltage), expected)

    def test_raw_osm_voltage_is_always_divided_by_1000(self):
        self.assertEqual(MODULE.normalize_voltage_kv({"voltage": 400}), 0.4)
        self.assertEqual(MODULE.normalize_voltage_kv({"voltage": 400000}), 400)
        self.assertEqual(MODULE.normalize_voltage_kv({"voltage": "20000;400"}), 20)
        self.assertEqual(MODULE.normalize_voltage_kv({"voltage": "400000;225000"}), 400)

    def test_raw_voltage_has_priority_over_stale_derived_values(self):
        props = {"voltageRaw": "400", "voltageMaxKv": 400, "voltagesKv": [400]}
        self.assertEqual(MODULE.normalize_voltage_kv(props), 0.4)

    def test_multilinestring_is_normalized_to_linestring_parts(self):
        geometry = {
            "type": "MultiLineString",
            "coordinates": [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
        }
        parts = MODULE.normalize_line_geometries(geometry)
        self.assertEqual(len(parts), 2)
        self.assertTrue(all(part["type"] == "LineString" for part in parts))

    def test_polygon_substation_uses_point_inside_surface(self):
        polygon = Polygon([(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4)])
        point, converted = MODULE._substation_point(mapping(polygon), polygon)
        self.assertTrue(converted)
        self.assertEqual(point["type"], "Point")
        self.assertTrue(polygon.covers(MODULE.shape(point)))


class RuntimeValidationTests(unittest.TestCase):
    def test_committed_runtime_outputs_are_complete(self):
        for country_code in ("TR", "ES", "FR", "PT", "IT"):
            with self.subTest(country_code=country_code):
                manifest = MODULE.validate_runtime(country_code)
                self.assertEqual(manifest["countryCode"], country_code)
                self.assertEqual(manifest["invalidGeometryCount"], 0)
                self.assertEqual(manifest["duplicateAssetCount"], 0)
                if country_code in MODULE.OSM_COUNTRY_CODES:
                    self.assertIn("sourceContribution", manifest)
                    self.assertIn("coverage", manifest)
                    self.assertFalse(manifest["partial"])
                    self.assertEqual(manifest["failedRequests"], 0)
                    self.assertEqual(manifest["suspectedGapTileCount"], 0)

    def test_runtime_schema_voltage_labels_and_manifest_counts(self):
        required = {
            "assetId", "countryCode", "assetType", "powerType", "osmType", "osmId",
            "actualVoltagesKv", "actualVoltageKv", "gridClass", "displayClass", "name",
            "ref", "operator", "from", "to", "displayLabel", "labelSource", "voltageRaw",
            "circuits", "cables", "frequency", "location", "sourceProvider", "sourceFallback",
            "sourceLicense", "osmTimestamp",
        }
        for country_code in ("ES", "FR", "PT", "IT"):
            with self.subTest(country_code=country_code):
                country_dir = MODULE.OUTPUT_ROOT / country_code
                manifest = json.loads((country_dir / "manifest.json").read_text(encoding="utf-8"))
                expected_counts = {
                    "grid_400.geojson": manifest["grid400Count"],
                    "grid_154.geojson": manifest["grid154Count"],
                    "substations.geojson": manifest["substationCount"],
                }
                seen = set()
                for filename, expected_count in expected_counts.items():
                    data = json.loads((country_dir / filename).read_text(encoding="utf-8"))
                    self.assertEqual(len(data["features"]), expected_count)
                    for feature in data["features"]:
                        props = feature["properties"]
                        self.assertEqual(feature["geometry"]["type"], "Point" if filename == "substations.geojson" else "LineString")
                        self.assertEqual(props["countryCode"], country_code)
                        self.assertTrue(props["assetId"].startswith(f"{country_code}-"))
                        self.assertNotIn(props["assetId"], seen)
                        seen.add(props["assetId"])
                        self.assertEqual(set(props), required)
                        self.assertTrue(props["displayLabel"])
                        self.assertIn(props["labelSource"], {"osm-name", "osm-ref", "osm-from-to", "generated-identifier"})
                        if filename != "substations.geojson":
                            voltage = props["actualVoltageKv"]
                            self.assertGreaterEqual(voltage, 50)
                            self.assertLessEqual(voltage, 550)
                            self.assertEqual(MODULE.voltage_class(voltage), props["gridClass"])


if __name__ == "__main__":
    unittest.main()
