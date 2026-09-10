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


if __name__ == "__main__":
    unittest.main()
