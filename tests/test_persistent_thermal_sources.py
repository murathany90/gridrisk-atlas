import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "build_persistent_thermal_sources.py"
SPEC = importlib.util.spec_from_file_location("persistent_thermal_sources", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class PersistentThermalSourceBuilderTests(unittest.TestCase):
    def test_builder_derives_robust_metrics_and_real_osm_solar_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            history = root / "history.csv"
            history.write_text(
                "latitude,longitude,acq_date,acq_time,frp,sourceId,satellite,daynight\n"
                "38.6000,35.2000,2026-08-01,1000,4,VIIRS_NOAA21_NRT,NOAA-21,D\n"
                "38.6001,35.2001,2026-08-02,1010,8,VIIRS_NOAA20_NRT,NOAA-20,D\n"
                "38.6002,35.2002,2026-08-03,1020,14,VIIRS_NOAA21_NRT,NOAA-21,D\n"
                "38.6001,35.2001,2026-08-04,1030,23,VIIRS_NOAA20_NRT,NOAA-20,D\n"
                "38.6000,35.2000,2026-08-05,1040,30,VIIRS_NOAA21_NRT,NOAA-21,D\n",
                encoding="utf-8",
            )
            osm = root / "osm.geojson"
            osm.write_text(json.dumps({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [35.2, 38.6]},
                    "properties": {"power": "plant", "plant:source": "solar"},
                }],
            }), encoding="utf-8")
            args = type("Args", (), {
                "input": [history], "osm": osm, "country": "TR", "cell_metres": 500,
                "min_detections": 5, "osm_radius_km": 1.0, "radius_padding_km": 0.25,
            })()
            result = MODULE.build(args)
        self.assertEqual(len(result["features"]), 1)
        properties = result["features"][0]["properties"]
        self.assertEqual(properties["classification"], "STATIC_SOLAR_GLINT")
        self.assertEqual(properties["detectionCount"], 5)
        self.assertEqual(properties["dayCount"], 5)
        self.assertEqual(properties["nightCount"], 0)
        self.assertEqual(properties["satelliteCount"], 2)
        self.assertIn("centroidVarianceKm2", properties)
        self.assertEqual(properties["sensorFamilyCount"], 1, "NOAA-20/21 stay in the VIIRS family")
        self.assertEqual(properties["medianFrpMw"], 14)
        self.assertGreaterEqual(properties["p99FrpMw"], 29)

    def test_committed_tr_canonical_dataset_matches_runtime_schema(self):
        dataset = Path(__file__).resolve().parents[1] / "data" / "countries" / "TR" / "persistent_thermal_sources.geojson"
        self.assertTrue(dataset.is_file(), "TR canonical persistent-thermal dataset must be committed")
        payload = json.loads(dataset.read_text(encoding="utf-8"))
        self.assertEqual(payload.get("type"), "FeatureCollection")
        features = payload.get("features", [])
        self.assertGreater(len(features), 0, "canonical dataset must not ship empty")
        required = {"classification", "radiusKm", "detectionCount", "uniqueDetectionDays", "dayCount", "nightCount", "medianFrpMw", "p99FrpMw", "centroidVarianceKm2", "historyStart", "historyEnd"}
        allowed_classes = {"STATIC_SOLAR_GLINT", "STATIC_INDUSTRIAL", "PERSISTENT_UNKNOWN"}
        for feature in features:
            properties = feature.get("properties", {})
            self.assertTrue(required.issubset(properties), f"missing runtime properties: {required - set(properties)}")
            self.assertIn(properties.get("classification"), allowed_classes)
            self.assertGreaterEqual(properties.get("detectionCount", 0), 1)
            self.assertGreaterEqual(properties.get("radiusKm", 0), 0)
        metadata = payload.get("metadata", {})
        self.assertTrue(metadata.get("historyStart") and metadata.get("historyEnd"), "dataset must record its historical window")

    def test_two_day_burst_fails_unique_day_gate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            history = root / "history.csv"
            rows = ["latitude,longitude,acq_date,acq_time,frp,sourceId,satellite,daynight"]
            for index in range(5):
                rows.append(f"38.600{index},35.200{index},2026-08-01,10{index:02d},8,VIIRS_NOAA21_NRT,NOAA-21,D")
            for index in range(5):
                rows.append(f"38.600{index},35.200{index},2026-08-02,11{index:02d},9,VIIRS_NOAA20_NRT,NOAA-20,N")
            history.write_text("\n".join(rows) + "\n", encoding="utf-8")
            args = type("Args", (), {
                "input": [history], "osm": None, "country": "TR", "cell_metres": 500,
                "min_detections": 5, "min_unique_days": 5, "osm_radius_km": 1.0, "radius_padding_km": 0.25,
            })()
            result = MODULE.build(args)
        self.assertEqual(len(result["features"]), 0, "10 detections on 2 days must not become persistent")

    def test_night_dominant_solar_near_cell_is_not_solar_glint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            history = root / "history.csv"
            history.write_text(
                "latitude,longitude,acq_date,acq_time,frp,sourceId,satellite,daynight\n"
                "36.2630,33.7280,2026-09-03,1000,2,VIIRS_NOAA21_NRT,NOAA-21,D\n"
                "36.2630,33.7280,2026-09-04,0130,2,VIIRS_NOAA20_NRT,NOAA-20,N\n"
                "36.2630,33.7280,2026-09-05,0140,1,VIIRS_NOAA21_NRT,NOAA-21,N\n"
                "36.2630,33.7280,2026-09-06,0150,2,VIIRS_SNPP_NRT,SNPP,N\n"
                "36.2630,33.7280,2026-09-07,0200,1,VIIRS_NOAA21_NRT,NOAA-21,N\n",
                encoding="utf-8",
            )
            osm = root / "osm.geojson"
            osm.write_text(json.dumps({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [33.728, 36.263]},
                    "properties": {"power": "plant", "plant:source": "solar"},
                }],
            }), encoding="utf-8")
            args = type("Args", (), {
                "input": [history], "osm": osm, "country": "TR", "cell_metres": 500,
                "min_detections": 5, "min_unique_days": 2, "osm_radius_km": 1.0, "radius_padding_km": 0.25,
            })()
            result = MODULE.build(args)
        self.assertEqual(len(result["features"]), 1)
        self.assertNotEqual(
            result["features"][0]["properties"]["classification"], "STATIC_SOLAR_GLINT",
            "night-dominant repeaters need industrial-grade evidence, not a solar label",
        )


if __name__ == "__main__":
    unittest.main()
