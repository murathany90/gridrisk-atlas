#!/usr/bin/env node
/**
 * EUMETView WFS BBOX axis-order probe
 * Compares west,south,east,north vs south,west,north,east
 * and CRS:84 vs EPSG:4326 for MTG and SLSTR layers.
 */

const BASE = "https://view.eumetsat.int/geoserver/ows";

// Turkey bounds from config.js
const TR = { west: 25.60, south: 35.75, east: 44.90, north: 42.20 };

const LAYERS = [
  "mtg_fd:frp",
  "copernicus:sentinel3a_slstr_level2_frp",
  "copernicus:sentinel3b_slstr_level2_frp",
];

function iso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const FROM = iso(48);
const TO = iso(0);

async function probe(label, layer, cqlBbox, srs) {
  let cql = `BBOX(geom, ${cqlBbox})`;
  cql += ` AND time >= '${FROM}' AND time <= '${TO}'`;

  const params = new URLSearchParams();
  params.set("service", "WFS");
  params.set("version", "2.0.0");
  params.set("request", "GetFeature");
  params.set("typeNames", layer);
  params.set("outputFormat", "application/json");
  params.set("count", "2000");
  params.set("cql_filter", cql);
  if (srs) params.set("srsName", srs);

  const url = `${BASE}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return { label, layer, cqlBbox, srs, error: `HTTP ${res.status}`, features: [] };
    const data = await res.json();
    const features = data.features || [];
    const numberMatched = data.numberMatched ?? data.totalFeatures ?? null;
    const numberReturned = data.numberReturned ?? features.length;

    // Analyse coordinates
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    let insideTR = 0, outsideTR = 0;
    let west = 0, central = 0, east = 0;
    let mismatchCount = 0;
    const samples = [];

    for (const f of features) {
      const p = f.properties || {};
      const g = f.geometry?.coordinates;
      const propLat = p.Lat != null ? Number(p.Lat) : null;
      const propLon = p.Lon != null ? Number(p.Lon) : null;
      const geomLon = g ? g[0] : null;
      const geomLat = g ? g[1] : null;

      // Use property values as primary, fallback to geometry
      const lat = propLat ?? geomLat;
      const lon = propLon ?? geomLon;

      if (lat != null && lon != null) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;

        const inside = lon >= TR.west && lon <= TR.east && lat >= TR.south && lat <= TR.north;
        if (inside) insideTR++; else outsideTR++;

        if (lon < 30) west++;
        else if (lon >= 30 && lon <= 36) central++;
        else east++;
      }

      // Check property vs geometry mismatch
      if (propLat != null && geomLat != null && propLon != null && geomLon != null) {
        const dLat = Math.abs(propLat - geomLat);
        const dLon = Math.abs(propLon - geomLon);
        if (dLat > 0.01 || dLon > 0.01) {
          mismatchCount++;
          if (samples.length < 5) {
            samples.push({
              id: f.id,
              propLat, propLon, geomLat, geomLon,
              dLat: dLat.toFixed(4), dLon: dLon.toFixed(4),
            });
          }
        }
      }
    }

    // Check for potential lat/lon swap: are geom coords [lat,lon] instead of [lon,lat]?
    let swapSuspected = 0;
    for (const f of features.slice(0, Math.min(features.length, 50))) {
      const p = f.properties || {};
      const g = f.geometry?.coordinates;
      if (g && p.Lat != null && p.Lon != null) {
        const propLat = Number(p.Lat), propLon = Number(p.Lon);
        // Normal GeoJSON: g[0]=lon, g[1]=lat
        const normalMatch = Math.abs(g[0] - propLon) < 0.01 && Math.abs(g[1] - propLat) < 0.01;
        // Swapped: g[0]=lat, g[1]=lon
        const swapMatch = Math.abs(g[0] - propLat) < 0.01 && Math.abs(g[1] - propLon) < 0.01;
        if (swapMatch && !normalMatch) swapSuspected++;
      }
    }

    // Confidence field analysis
    let confSamples = [];
    for (const f of features.slice(0, 20)) {
      const p = f.properties || {};
      const fields = Object.keys(p);
      const confField = fields.find(k => /confidence/i.test(k));
      const frpErrField = fields.find(k => /FRPerr/i.test(k));
      const btMirField = fields.find(k => /BT_mir/i.test(k));
      const btTirField = fields.find(k => /BT_tir/i.test(k));
      if (confSamples.length < 3) {
        confSamples.push({
          FRP: p.FRP,
          Confidence: p.Confidence,
          FRPerr: p.FRPerr,
          BT_mir_k: p.BT_mir_k,
          BT_tir_k: p.BT_tir_k,
          SZA: p.SZA,
          AcrossSize: p.AcrossSize,
          AlongSize: p.AlongSize,
          allFields: fields,
        });
      }
    }

    return {
      label, layer, cqlBbox, srs,
      numberMatched, numberReturned: features.length,
      latRange: features.length ? [minLat.toFixed(4), maxLat.toFixed(4)] : null,
      lonRange: features.length ? [minLon.toFixed(4), maxLon.toFixed(4)] : null,
      insideTR, outsideTR,
      distribution: { west, central, east },
      mismatchCount,
      mismatchSamples: samples,
      swapSuspected: `${swapSuspected}/${Math.min(features.length, 50)}`,
      confSamples,
    };
  } catch (e) {
    clearTimeout(timer);
    return { label, layer, cqlBbox, srs, error: e.message, features: [] };
  }
}

async function main() {
  console.log(`Probe started: ${new Date().toISOString()}`);
  console.log(`Time window: ${FROM} -> ${TO}`);
  console.log(`TR bounds: west=${TR.west} south=${TR.south} east=${TR.east} north=${TR.north}\n`);

  const tests = [];

  for (const layer of LAYERS) {
    // A: Current app order: west,south,east,north (standard CQL BBOX for CRS:84)
    const bboxA = `${TR.west}, ${TR.south}, ${TR.east}, ${TR.north}`;
    tests.push(probe(`${layer} | CQL w,s,e,n`, layer, bboxA, null));

    // B: EPSG:4326 axis order: south,west,north,east
    const bboxB = `${TR.south}, ${TR.west}, ${TR.north}, ${TR.east}`;
    tests.push(probe(`${layer} | CQL s,w,n,e`, layer, bboxB, null));

    // C: With explicit srsName=CRS:84
    tests.push(probe(`${layer} | CQL w,s,e,n + CRS:84`, layer, bboxA, "urn:ogc:def:crs:OGC::CRS84"));

    // D: With explicit srsName=EPSG:4326
    tests.push(probe(`${layer} | CQL s,w,n,e + EPSG:4326`, layer, bboxB, "EPSG:4326"));
  }

  const results = await Promise.all(tests);
  for (const r of results) {
    console.log("─".repeat(80));
    console.log(`Layer: ${r.layer}`);
    console.log(`Label: ${r.label}`);
    console.log(`SRS:   ${r.srs || "(none)"}`);
    if (r.error) {
      console.log(`ERROR: ${r.error}`);
      continue;
    }
    console.log(`numberMatched:  ${r.numberMatched}`);
    console.log(`numberReturned: ${r.numberReturned}`);
    console.log(`lat range: ${r.latRange?.[0]} .. ${r.latRange?.[1]}`);
    console.log(`lon range: ${r.lonRange?.[0]} .. ${r.lonRange?.[1]}`);
    console.log(`inside TR:  ${r.insideTR}`);
    console.log(`outside TR: ${r.outsideTR}`);
    console.log(`distribution: west=${r.distribution.west} central=${r.distribution.central} east=${r.distribution.east}`);
    console.log(`property/geometry mismatch: ${r.mismatchCount}`);
    if (r.mismatchSamples.length) {
      console.log(`  samples:`);
      for (const s of r.mismatchSamples) {
        console.log(`    ${s.id}: prop(${s.propLat},${s.propLon}) geom(${s.geomLat},${s.geomLon}) delta(${s.dLat},${s.dLon})`);
      }
    }
    console.log(`swap suspected: ${r.swapSuspected}`);
    if (r.confSamples?.length) {
      console.log(`  field samples (first 3):`);
      for (const s of r.confSamples) {
        console.log(`    FRP=${s.FRP} Conf=${s.Confidence} FRPerr=${s.FRPerr} BT_mir=${s.BT_mir_k} BT_tir=${s.BT_tir_k} SZA=${s.SZA} Across=${s.AcrossSize} Along=${s.AlongSize}`);
        if (r.confSamples.indexOf(s) === 0) console.log(`    allFields: ${s.allFields.join(", ")}`);
      }
    }
  }
  console.log("\n─".repeat(80));
  console.log("DONE");
}

main().catch(e => { console.error(e); process.exit(1); });
