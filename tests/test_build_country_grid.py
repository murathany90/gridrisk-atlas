import importlib.util
import json
import unittest
from collections import Counter
from pathlib import Path


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
            (299.99, "154"),
            (300, "400"),
            (400, "400"),
            (550, "400"),
            (551, None),
        )
        for voltage, expected in cases:
            with self.subTest(voltage=voltage):
                self.assertEqual(MODULE.voltage_class(voltage), expected)

    def test_voltage_parser_priority_and_units(self):
        self.assertEqual(MODULE.normalize_voltage_kv({"voltage": 400000}), 400)
        self.assertEqual(MODULE.normalize_voltage_kv({"voltage": "400000;225000"}), 400)
        self.assertEqual(MODULE.normalize_voltage_kv({"voltagesKv": [400, 225]}), 400)
        self.assertEqual(
            MODULE.normalize_voltage_kv(
                {"voltageMaxKv": 225, "voltagesKv": [400], "voltageRaw": "550000"}
            ),
            225,
        )
        self.assertIsNone(MODULE.normalize_voltage_kv({"voltage": "0;-4;NaN"}))

    def test_multilinestring_is_normalized_to_linestring_parts(self):
        geometry = {
            "type": "MultiLineString",
            "coordinates": [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
        }
        parts = MODULE.normalize_line_geometries(geometry)
        self.assertEqual(len(parts), 2)
        self.assertTrue(all(part["type"] == "LineString" for part in parts))


class RuntimeValidationTests(unittest.TestCase):
    def test_committed_runtime_outputs(self):
        for country_code in ("TR", "ES", "FR"):
            with self.subTest(country_code=country_code):
                manifest = MODULE.validate_runtime(country_code)
                self.assertEqual(manifest["countryCode"], country_code)
                self.assertEqual(manifest["invalidGeometryCount"], 0)
                self.assertEqual(manifest["duplicateAssetCount"], 0)

    def test_raw_expected_counts_and_france_partial_metadata(self):
        for country_code in ("ES", "FR"):
            features, metadata = MODULE._load_sources(country_code, MODULE.COUNTRIES[country_code])
            MODULE._validate_expected(country_code, features, MODULE.COUNTRIES[country_code])
            self.assertTrue(all((f.get("properties") or {}).get("countryCode") == country_code for f in features))
        _, france_metadata = MODULE._load_sources("FR", MODULE.COUNTRIES["FR"])
        diagnostics = france_metadata["downloadDiagnostics"]
        self.assertTrue(diagnostics["partial"])
        self.assertEqual(diagnostics["failedRequests"], 14)

    def test_raw_geometry_country_and_expected_type_counts(self):
        expected = {
            "ES": {"LineString": 15_264, "Point": 3_852},
            "FR": {"LineString": 55_981, "Point": 15_658},
        }
        for country_code, expected_types in expected.items():
            with self.subTest(country_code=country_code):
                features, _ = MODULE._load_sources(country_code, MODULE.COUNTRIES[country_code])
                counts = Counter((feature.get("geometry") or {}).get("type") for feature in features)
                self.assertEqual(dict(counts), expected_types)
                for feature in features:
                    self.assertTrue(MODULE.valid_geometry(feature.get("geometry")))
                    self.assertEqual((feature.get("properties") or {}).get("countryCode"), country_code)

    def test_runtime_schema_voltage_and_manifest_counts(self):
        allowed_line = {
            "assetId", "countryCode", "assetType", "actualVoltageKv", "gridClass",
            "displayClass", "voltageRaw", "name", "operator", "osmId", "powerType",
            "source", "sourceLicense",
        }
        allowed_substation = {
            "assetId", "countryCode", "assetType", "actualVoltageKv", "gridClass",
            "name", "operator", "osmId", "source", "sourceLicense",
        }
        for country_code in ("TR", "ES", "FR"):
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
                        self.assertEqual(set(props), allowed_substation if filename == "substations.geojson" else allowed_line)
                        if filename != "substations.geojson":
                            voltage = props["actualVoltageKv"]
                            self.assertGreaterEqual(voltage, 50)
                            self.assertLessEqual(voltage, 550)
                            self.assertEqual(MODULE.voltage_class(voltage), props["gridClass"])


if __name__ == "__main__":
    unittest.main()
