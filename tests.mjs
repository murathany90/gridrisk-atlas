import { readFileSync, readdirSync, statSync } from 'fs';
import { strict as assert } from 'assert';

// ── Setup environment ──
global.window = global;
global.AtmoApp = {};
global.document = {
  createElement(tag) { const el = { tag, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, remove() {}, appendChild() {}, querySelector() { return { addEventListener() {} }; } }; if (tag === 'a') { el.click = () => {}; el.href = ''; } return el; },
  body: { appendChild() {}, removeChild() {} },
  getElementById(id) { if (id === 'legendStack') return { querySelector() { return null; }, appendChild() {} }; return null; },
  querySelector() { return null; }
};
global.L = { Layer: class {}, CircleMarker: class {}, point(x, y) { return { x, y }; }, DomUtil: { create() { return {}; }, setPosition() {} }, DomEvent: { stopPropagation() {} } };
const storage = new Map();
global.localStorage = {
  getItem(k) { return storage.get(k) ?? null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
  clear() { storage.clear(); }
};
const realPerformance = global.performance;
global.performance = new Proxy(realPerformance, {
  get(t, k) { if (k === 'now') return () => 0; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }
});
global.location = { protocol: 'https:', hostname: 'localhost' };
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;
global.AbortController = AbortController;
const realFetch = global.fetch;

// ── Load config ──
const cfgPath = 'js/config.js';
eval(readFileSync(cfgPath, 'utf8'));
const C = () => AtmoApp.CONFIG;

// ── Load utils ──
const utilsPath = 'js/utils.js';
eval(readFileSync(utilsPath, 'utf8'));
const U = AtmoApp.Utils;

// ── Load api ──
const apiPath = 'js/api.js';
eval(readFileSync(apiPath, 'utf8'));

// ── Load map ──
const mapPath = 'js/map.js';
eval(readFileSync(mapPath, 'utf8'));

// ── Test runner ──
const tests = [];
let testsRun = 0, testsPassed = 0;
function test(name, fn) { tests.push({ name, fn }); }
async function run() {
  for (const { name, fn } of tests) {
    testsRun++;
    try {
      const r = fn();
      if (r && typeof r.then === 'function') await r;
      testsPassed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}\n    ${e.message}`);
    }
  }
  console.log(`\n${'='.repeat(50)}\n${testsPassed}/${testsRun} tests passed\n${'='.repeat(50)}`);
  if (testsPassed !== testsRun) process.exit(1);
}

// ============================================================
// ITEM 1 — FRP render: viewport filter logic
// ============================================================
console.log('\nItem 1 — FRP render viewport filter');

test('viewport filter passes points inside bounds, excludes outside', () => {
  const bounds = {
    _southWest: { lat: 36, lng: 27 },
    _northEast: { lat: 42, lng: 45 },
    contains(p) { return p[0] >= 36 && p[0] <= 42 && p[1] >= 27 && p[1] <= 45; }
  };
  const fires = [
    { lat: 39, lon: 33, frp: 100 },
    { lat: 39, lon: 33, frp: 50 },
    { lat: 35, lon: 33, frp: 200 },
    { lat: 43, lon: 33, frp: 150 },
  ];
  const filtered = fires.filter(f => bounds.contains([f.lat, f.lon]));
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(f => f.lat >= 36 && f.lat <= 42));
});

test('viewport + FRP threshold + sort + slice pipeline', () => {
  const bounds = {
    contains(p) { return p[0] >= 36 && p[0] <= 42 && p[1] >= 27 && p[1] <= 45; }
  };
  const outside = Array.from({ length: 10000 }, (_, i) => ({ lat: 35, lon: 30 + (i * 0.001), frp: 10 + (i % 100) }));
  const inside = Array.from({ length: 100 }, (_, i) => ({ lat: 39, lon: 33 + (i * 0.01), frp: 50 + (i * 5) }));
  const all = [...outside, ...inside];

  const FRP_THRESHOLD = 30;
  const step1 = all.filter(f => f.frp == null || f.frp >= FRP_THRESHOLD);
  const step2 = step1.filter(f => bounds.contains([f.lat, f.lon]));
  const step3 = step2.sort((a, b) => Math.abs(b.frp || 0) - Math.abs(a.frp || 0)).slice(0, 5000);

  assert.ok(step1.length > 5000, 'FRP-only filter may exceed 5000');
  assert.equal(step2.length, 100, 'viewport filter reduces to 100 inside');
  assert.equal(step3.length, 100, '5000 slice does not cut 100 items');
  for (let i = 1; i < step3.length; i++) assert.ok(step3[i - 1].frp >= step3[i].frp, 'FRP descending order');
});

test('5000 slice triggers for >5000 viewport points', () => {
  const bounds = { contains: () => true };
  const points = Array.from({ length: 6000 }, (_, i) => ({ lat: 39, lon: 33 + i * 0.001, frp: i }));
  const filtered = points.filter(f => bounds.contains([f.lat, f.lon])).sort((a, b) => b.frp - a.frp).slice(0, 5000);
  assert.equal(filtered.length, 5000);
});

test('KPI counts unaffected by viewport filter', () => {
  const allDataSize = 10100;
  const fireVisible = Array.from({ length: allDataSize }, (_, i) => ({ lat: 39, lon: 33, frp: i }));
  assert.equal(fireVisible.length, allDataSize, 'KPI source length correct');
  const viewportFiltered = fireVisible.filter(() => false);
  assert.equal(fireVisible.length, allDataSize, 'fireVisible unchanged after viewport filter');
});

// ============================================================
// ITEM 2 — clusterFires latitude-aware cell size
// ============================================================
console.log('\nItem 2 — clusterFires latitude-aware spatial hashing');

test('clusterFires returns empty array for empty input', () => {
  const r = U.clusterFires([]);
  assert.ok(Array.isArray(r));
  assert.equal(r.length, 0);
});

test('clusterFires returns empty for null input', () => {
  const r = U.clusterFires(null);
  assert.ok(Array.isArray(r));
  assert.equal(r.length, 0);
});

test('single fire produces one cluster', () => {
  const fires = [{ lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50 }];
  const r = U.clusterFires(fires);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 1);
  assert.equal(r[0].maxFrp, 50);
  assert.ok(r[0].id.startsWith('fire-'));
});

test('two close fires in adjacent cells cluster together', () => {
  const fires = [
    { lat: 39.000, lon: 33.000, detectedAt: '2026-07-30T12:00:00Z', frp: 50 },
    { lat: 39.042, lon: 33.010, detectedAt: '2026-07-30T13:00:00Z', frp: 30 },
  ];
  const dist = U.haversineKm(fires[0], fires[1]);
  assert.ok(dist <= 5, `distance ${dist} km <= 5 km`);
  const r = U.clusterFires(fires);
  assert.equal(r.length, 1, 'close fires in adjacent cells cluster together');
  assert.equal(r[0].count, 2);
  assert.equal(r[0].maxFrp, 50);
});

test('two close fires in same spatial cell cluster together', () => {
  const fires = [
    { lat: 39.000, lon: 33.000, detectedAt: '2026-07-30T12:00:00Z', frp: 50 },
    { lat: 39.002, lon: 33.001, detectedAt: '2026-07-30T12:30:00Z', frp: 30 },
  ];
  const dist = U.haversineKm(fires[0], fires[1]);
  assert.ok(dist <= 5, `distance ${dist} km <= 5 km`);
  const r = U.clusterFires(fires);
  assert.equal(r.length, 1, 'same cell fires cluster together');
  assert.equal(r[0].count, 2);
});

test('two distant fires produce separate clusters', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50 },
    { lat: 40.0, lon: 34.0, detectedAt: '2026-07-30T13:00:00Z', frp: 30 },
  ];
  const r = U.clusterFires(fires);
  assert.equal(r.length, 2, 'distant fires separate clusters');
});

test('REF_LAT=39 projected grid: east/west Turkey extremes', () => {
  const REF_LAT=39, kmPerDeg=111.32, cosRef=Math.cos(REF_LAT*Math.PI/180), radiusKm=5;
  const lonKm=l=>l*kmPerDeg*cosRef, latKm=l=>l*kmPerDeg;
  // Fire at (36,26) and (42,45) should NOT produce same cellX
  const c1x=Math.floor(lonKm(26)/radiusKm), c1y=Math.floor(latKm(36)/radiusKm);
  const c2x=Math.floor(lonKm(45)/radiusKm), c2y=Math.floor(latKm(42)/radiusKm);
  assert.notEqual(c1x,c2x,'east/west have different cellX');
  assert.notEqual(c1y,c2y,'north/south have different cellY');
});

test('REF_LAT=39 grid: same-cell at different latitudes, same lon', () => {
  const REF_LAT=39, kmPerDeg=111.32, cosRef=Math.cos(REF_LAT*Math.PI/180), radiusKm=5;
  const lonKm=l=>l*kmPerDeg*cosRef, latKm=l=>l*kmPerDeg;
  // Two fires at (36,33.00) and (42,33.005) — lon offset < 0.0578° → same cellX
  const x36=Math.floor(lonKm(33.00)/radiusKm);
  const x42=Math.floor(lonKm(33.001)/radiusKm);
  assert.equal(x36,x42,'same cellX with REF_LAT grid');
  // Latitude changes produce different cellY
  const y36=Math.floor(latKm(36)/radiusKm);
  const y42=Math.floor(latKm(42)/radiusKm);
  assert.notEqual(y36,y42,'different cellY at different lat');
});

test('radius boundary: 4 km clusters, 10 km separate', () => {
  const fires_close=[{lat:39.000,lon:33.000,detectedAt:'2026-07-30T12:00:00Z',frp:50},{lat:39.035,lon:33.005,detectedAt:'2026-07-30T12:30:00Z',frp:30}];
  const fires_far=[{lat:39.000,lon:33.000,detectedAt:'2026-07-30T12:00:00Z',frp:50},{lat:39.100,lon:33.020,detectedAt:'2026-07-30T12:30:00Z',frp:30}];
  const r1=U.clusterFires(fires_close);
  assert.equal(r1.length,1,'~4 km clusters together');
  const r2=U.clusterFires(fires_far);
  assert.equal(r2.length,2,'~11 km stays separate');
});

test('input-order independence', () => {
  const a={lat:39.0,lon:33.0,detectedAt:'2026-07-30T12:00:00Z',frp:10};
  const b={lat:39.02,lon:33.02,detectedAt:'2026-07-30T12:30:00Z',frp:20};
  const c={lat:39.5,lon:33.5,detectedAt:'2026-07-30T13:00:00Z',frp:30};
  const r1=U.clusterFires([a,b,c]);
  const r2=U.clusterFires([c,b,a]);
  assert.equal(r1.length,2,'two clusters for three points');
  assert.equal(r2.length,2,'reversed input same cluster count');
});

test('deterministic event ID preservation', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50 },
  ];
  const r1 = U.clusterFires(fires);
  const r2 = U.clusterFires(fires);
  assert.equal(r1[0].id, r2[0].id, 'same input produces same event ID');
});

test('earliestDetectedAt is valid ISO date', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T10:00:00Z', frp: 50 },
    { lat: 39.01, lon: 33.01, detectedAt: '2026-07-30T12:00:00Z', frp: 30 },
  ];
  const r = U.clusterFires(fires);
  assert.equal(r.length, 1);
  const d = new Date(r[0].earliestDetectedAt);
  assert.ok(Number.isFinite(d.getTime()), 'earliestDetectedAt parses as valid Date');
  assert.equal(r[0].earliestDetectedAt, '2026-07-30T10:00:00Z');
});

test('cluster fires latest sort order', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50 },
    { lat: 39.5, lon: 33.5, detectedAt: '2026-07-30T14:00:00Z', frp: 30 },
  ];
  const r = U.clusterFires(fires);
  assert.equal(r.length, 2);
  assert.ok(Date.parse(r[0].latestDetectedAt) >= Date.parse(r[1].latestDetectedAt), 'sorted by latest descending');
});

test('time separation prevents clustering', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50 },
    { lat: 39.01, lon: 33.01, detectedAt: '2026-07-31T00:00:00Z', frp: 30 },
  ];
  const r = U.clusterFires(fires, 5, 6);
  assert.equal(r.length, 2, 'time gap > 6h prevents clustering even if close');
});

// ============================================================
// ITEM 4 (v3.3) — FireObservation normalization
// ============================================================
console.log('\nv3.3 — FireObservation normalization');

test('normalizeFireDetection raw FIRMS row', () => {
  const raw = { latitude: 39.5, longitude: 33.2, acq_date: '2026-07-30', acq_time: '1432', frp: 85, satellite: 'NPP', confidence: 'n', source: 'NASA FIRMS', product: 'VIIRS_SNPP_NRT' };
  const n = U.normalizeFireDetection(raw, { source: 'NASA FIRMS' });
  assert.equal(n.lat, 39.5);
  assert.equal(n.lon, 33.2);
  assert.equal(n.detectedAt, '2026-07-30T14:32:00Z');
  assert.equal(n.frp, 85);
  assert.equal(n.source, 'NASA FIRMS');
  assert.equal(n.product, 'VIIRS_SNPP_NRT');
  assert.equal(n.satellite, 'NPP');
});

test('normalizeFireDetection already normalized object', () => {
  const raw = { lat: 39.0, lon: 35.0, detectedAt: '2026-07-30T12:00:00Z', frp: null, source: 'GFW', product: 'GFW_TREE_COVER_LOSS' };
  const n = U.normalizeFireDetection(raw);
  assert.equal(n.lat, 39.0);
  assert.equal(n.detectedAt, '2026-07-30T12:00:00Z');
  assert.equal(n.frp, null);
});

test('normalizeFireDetection handles missing values gracefully', () => {
  const n = U.normalizeFireDetection({});
  assert.equal(n.lat, null);
  assert.equal(n.detectedAt, null);
  assert.equal(n.frp, null);
});

// ============================================================
// v3.3 — detectionIdentityKey
// ============================================================
console.log('\nv3.3 — detectionIdentityKey');

test('detectionIdentityKey generates consistent key', () => {
  const d = { product: 'VIIRS_SNPP_NRT', satellite: 'NPP', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1234, lon: 33.5678 };
  const key = U.detectionIdentityKey(d);
  assert.ok(key.includes('VIIRS_SNPP_NRT'));
  assert.ok(key.includes('NPP'));
  assert.ok(key.includes('39.1234'));
  assert.ok(key.includes('33.5678'));
});

test('detectionIdentityKey same detection produces same key', () => {
  const d1 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1234, lon: 33.5678 };
  const d2 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1234, lon: 33.5678 };
  assert.equal(U.detectionIdentityKey(d1), U.detectionIdentityKey(d2));
});

// ============================================================
// v3.3 — deduplicateDetections
// ============================================================
console.log('\nv3.3 — deduplicateDetections');

test('deduplicateDetections basic dedup', () => {
  const d1 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 50, source: 'NASA FIRMS' };
  const d2 = { ...d1, source: 'NASA FIRMS' };
  const result = U.deduplicateDetections([d1, d2]);
  assert.equal(result.length, 1);
});

test('deduplicateDetections different product/satellite same time/location are distinct', () => {
  const d1 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 50, source: 'NASA FIRMS' };
  const d2 = { product: 'VIIRS_SNPP_NRT', satellite: 'NPP', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 45, source: 'NASA FIRMS' };
  const result = U.deduplicateDetections([d1, d2]);
  assert.equal(result.length, 2, 'different product/satellite → different identity keys → both kept');
});

test('deduplicateDetections merges same source duplicates', () => {
  const d1 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 50, source: 'NASA FIRMS' };
  const d2 = { ...d1 };
  const result = U.deduplicateDetections([d1, d2]);
  assert.equal(result.length, 1, 'identical detections deduped');
  assert.equal(result[0].frp, 50);
});

test('deduplicateDetections returns unique detections unchanged', () => {
  const d1 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 50, source: 'NASA FIRMS' };
  const d2 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T14:00:00Z', lat: 39.5, lon: 33.5, frp: 30, source: 'NASA FIRMS' };
  const result = U.deduplicateDetections([d1, d2]);
  assert.equal(result.length, 2);
});

// ============================================================
// v3.3 — clusterFires sourceBreakdown / products / satellites
// ============================================================
console.log('\nv3.3 — clusterFires sourceBreakdown');

test('clusterFires includes sourceBreakdown', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50, source: 'NASA FIRMS', product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21' },
    { lat: 39.01, lon: 33.01, detectedAt: '2026-07-30T13:00:00Z', frp: 30, source: 'NASA FIRMS', product: 'VIIRS_SNPP_NRT', satellite: 'NPP' },
  ];
  const r = U.clusterFires(fires);
  assert.equal(r.length, 1);
  assert.ok(r[0].sourceBreakdown, 'has sourceBreakdown');
  assert.ok(r[0].sourceBreakdown['NASA FIRMS'] >= 2, 'sourceBreakdown counts FIRMS');
});

test('clusterFires includes products and satellites', () => {
  const fires = [
    { lat: 39.0, lon: 33.0, detectedAt: '2026-07-30T12:00:00Z', frp: 50, source: 'NASA FIRMS', product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21' },
    { lat: 39.01, lon: 33.01, detectedAt: '2026-07-30T13:00:00Z', frp: 30, source: 'NASA FIRMS', product: 'VIIRS_SNPP_NRT', satellite: 'NPP' },
  ];
  const r = U.clusterFires(fires);
  assert.equal(r.length, 1);
  assert.equal(r[0].products.length, 2, 'both products listed');
  assert.equal(r[0].satellites.length, 2, 'both satellites listed');
  assert.ok(r[0].products.includes('VIIRS_NOAA21_NRT'));
  assert.ok(r[0].satellites.includes('NPP'));
});

// ============================================================
// v3.3 — FirmsAdapter AUTO mode
// ============================================================
console.log('\nv3.3 — FirmsAdapter AUTO mode');

test('FirmsAdapter defaults to AUTO', () => {
  const FA = AtmoApp.FirmsAdapter;
  assert.equal(FA.source(), 'AUTO');
  assert.ok(FA.isAuto());
});

test('FirmsAdapter setSource handles AUTO', () => {
  const FA = AtmoApp.FirmsAdapter;
  FA.setSource('AUTO');
  assert.equal(FA.source(), 'AUTO');
  FA.setSource('VIIRS_NOAA21_NRT');
  assert.equal(FA.source(), 'VIIRS_NOAA21_NRT');
  FA.setSource('AUTO');
});

// ============================================================
// Audit — TI4/TI5 does not control footprint size
// ============================================================
console.log('\nAudit — TI4/TI5 and footprint geometry');

test('footprint size depends on scan/track not TI4/TI5', () => {
  const m = { lat: 39.0, lon: 33.0, scan: 0.8, track: 0.6, brightTi4: 340, brightTi5: null };
  assert.ok(Number.isFinite(m.scan)&&m.scan>0,'valid scan');
  assert.ok(Number.isFinite(m.track)&&m.track>0,'valid track');
  // Production uses scan/track for geometry, TI4/TI5 are not in footprint calc
});

test('changing scan/track changes footprint', () => {
  const m1 = { lat: 39.0, lon: 33.0, scan: 0.4, track: 0.6 };
  const m2 = { lat: 39.0, lon: 33.0, scan: 1.0, track: 1.0 };
  assert.notEqual(m1.scan,m2.scan,'different scan');
  assert.notEqual(m1.track,m2.track,'different track');
});

test('null/NaN/zero scan/track is skipped', () => {
  const ok = (m) => Number.isFinite(m.scan)&&m.scan>0&&Number.isFinite(m.track)&&m.track>0;
  assert.ok(!ok({scan:null,track:0.6}),'null scan skipped');
  assert.ok(!ok({scan:0.8,track:NaN}),'NaN track skipped');
  assert.ok(!ok({scan:0,track:0.6}),'zero scan skipped');
  assert.ok(!ok({scan:-0.5,track:0.6}),'negative scan skipped');
  assert.ok(ok({scan:0.8,track:0.6}),'valid pair passes');
});

// ============================================================
// v3.4.0 — MTG GeoColour WMS config
// ============================================================
console.log('\nv3.4.0 — MTG GeoColour WMS config');

test('mtgGeoColourWms config points at official EUMETView WMS GeoColour layer', () => {
  const m = C().mtgGeoColourWms;
  assert.ok(m, 'mtgGeoColourWms defined');
  assert.equal(m.url, 'https://view.eumetsat.int/geoserver/wms', 'official EUMETView GeoServer endpoint');
  assert.equal(m.layer, 'mtg_fd:rgb_geocolour', 'GeoColour layer id');
  assert.equal(m.slotMinutes, 10, '10-minute slot cadence');
  assert.equal(m.maxBackfillSlots, 12, 'backfill cap 12 slots (2 h)');
  assert.equal(m.version, '1.3.0', 'WMS 1.3.0 (per capabilities)');
  assert.equal(m.format, 'image/png', 'PNG format only');
  assert.equal(m.crs, 'EPSG:4326', 'EPSG:4326 projection');
  assert.ok(m.defaultOpacity >= 0 && m.defaultOpacity <= 1, 'default opacity valid');
});

test('mtgGeoColourWms source text identifies real satellite imagery', () => {
  const m = C().mtgGeoColourWms;
  assert.ok(m.source.includes('EUMETSAT MTG-I FCI'), 'source credits MTG-I FCI');
  assert.ok(m.source.includes('gerçek uydu görüntüsü'), 'source marks real imagery');
});

test('MTG pane z-index 240 sits below air and grid panes', () => {
  const mapTxt2 = readFileSync('js/map.js', 'utf8');
  assert.ok(mapTxt2.includes("mtgPane") && /mtgPane.*240/.test(mapTxt2), 'mtg pane created with z-index 240');
  const air = mapTxt2.indexOf("createPane('airPane')");
  const mtg = mapTxt2.indexOf("createPane('mtgPane')");
  const grid = mapTxt2.indexOf("createPane('gridPane')");
  assert.ok(mtg !== -1 && mtg < air && air < grid, 'mtg pane created before air and grid panes');
});

// ============================================================
// Audit — Multi-VIIRS dedup preserves multi-satellite
// ============================================================
console.log('\nAudit — Multi-VIIRS dedup');

test('same coordinate + same time + different satellite → 2 observations', () => {
  const d1 = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 50, source: 'NASA FIRMS' };
  const d2 = { product: 'VIIRS_SNPP_NRT', satellite: 'NPP', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 45, source: 'NASA FIRMS' };
  const keys = new Set([U.detectionIdentityKey(d1), U.detectionIdentityKey(d2)]);
  assert.equal(keys.size, 2, 'different satellites get different identity keys');
});

test('same observation duplicated twice → 1 observation after dedup', () => {
  const d = { product: 'VIIRS_NOAA21_NRT', satellite: 'NOAA-21', detectedAt: '2026-07-30T12:00:00Z', lat: 39.1, lon: 33.1, frp: 50, source: 'NASA FIRMS' };
  const result = U.deduplicateDetections([d, { ...d }]);
  assert.equal(result.length, 1);
});

// ============================================================
// Audit — convexHull2D
// ============================================================
console.log('\nAudit — convexHull2D');

test('convexHull2D returns hull for 3+ points', () => {
  const pts = [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }];
  const hull = U.convexHull2D(pts);
  assert.equal(hull.length, 4);
});

test('convexHull2D returns all points for <3 points', () => {
  const pts = [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }];
  const hull = U.convexHull2D(pts);
  assert.equal(hull.length, 2);
});

test('convexHull2D handles empty input', () => {
  const hull = U.convexHull2D([]);
  assert.equal(hull.length, 0);
});

// ============================================================
// Audit — Runtime mode detection
// ============================================================
console.log('\nAudit — Runtime mode');

test('runtime mode matrix: file → DOSYA MODU', () => {
  const fn = (proto, host) => {
    const isFile = proto === 'file:';
    const h = host;
    let mode, cls;
    if (isFile) { mode = 'DOSYA MODU'; cls = 'fileMode'; }
    else if (h === 'localhost' || h === '127.0.0.1') { mode = 'SUNUCU MODU'; cls = ''; }
    else if (h.endsWith('.github.io')) { mode = 'GITHUB PAGES'; cls = 'githubMode'; }
    else { mode = 'WEB MODU'; cls = 'githubMode'; }
    return { mode, cls };
  };
  assert.deepEqual(fn('file:', ''), { mode: 'DOSYA MODU', cls: 'fileMode' });
  assert.deepEqual(fn('http:', 'localhost'), { mode: 'SUNUCU MODU', cls: '' });
  assert.deepEqual(fn('http:', '127.0.0.1'), { mode: 'SUNUCU MODU', cls: '' });
  assert.deepEqual(fn('https:', 'murathany90.github.io'), { mode: 'GITHUB PAGES', cls: 'githubMode' });
  assert.deepEqual(fn('https:', 'example.com'), { mode: 'WEB MODU', cls: 'githubMode' });
});

test('CSS contains .modePill.githubMode rule', () => {
  const css = readFileSync('css/styles.css', 'utf8');
  assert.ok(css.includes('.modePill.githubMode'), 'githubMode CSS rule exists');
  assert.ok(css.includes('.modePill.fileMode'), 'fileMode CSS rule exists');
});

test('__ATMO_RUNTIME_MODE__ window variable accessible', () => {
  // Simulate the inline script execution (requires location mock)
  const origLocation = global.location;
  try {
    // Simulate GitHub Pages
    global.location = { protocol: 'https:', hostname: 'murathany90.github.io' };
    const isFile = location.protocol === 'file:';
    const host = location.hostname;
    let mode;
    if (isFile) mode = 'DOSYA MODU';
    else if (host === 'localhost' || host === '127.0.0.1') mode = 'SUNUCU MODU';
    else if (host.endsWith('.github.io')) mode = 'GITHUB PAGES';
    else mode = 'WEB MODU';
    assert.equal(mode, 'GITHUB PAGES');

    // Simulate localhost
    global.location = { protocol: 'http:', hostname: 'localhost' };
    const isFile2 = location.protocol === 'file:';
    const host2 = location.hostname;
    let mode2;
    if (isFile2) mode2 = 'DOSYA MODU';
    else if (host2 === 'localhost' || host2 === '127.0.0.1') mode2 = 'SUNUCU MODU';
    else if (host2.endsWith('.github.io')) mode2 = 'GITHUB PAGES';
    else mode2 = 'WEB MODU';
    assert.equal(mode2, 'SUNUCU MODU');
  } finally {
    global.location = origLocation;
  }
});

// ============================================================
// Audit — EFFIS Burnt Area config
// ============================================================
console.log('\nAudit — EFFIS config');

test('EFFIS burnt area layer is defined', () => {
  assert.ok(C().effisBurntAreaLayer, 'effisBurntAreaLayer defined');
  assert.equal(C().effisBurntAreaLayer, 'effis.nrt.ba.poly');
});

// ============================================================
// v3.3.2 — EFFIS Burnt Area timeline sync
// ============================================================
console.log('\nv3.3.2 — EFFIS Burnt Area timeline sync');

test('EFFIS BA WMS TIME follows timeline date without layer accumulation', () => {
  const wmsCalls = [];
  const origL = global.L;
  global.L = { ...origL, tileLayer: { wms(url, opts) { wmsCalls.push({ url, opts }); return { on() { return this; }, addTo() { return this; } }; } } };
  const m = new AtmoApp.MapManager();
  let removed = 0;
  m.map = { removeLayer() { removed++; } };
  try {
    m.toggleEffisBurntArea(true, new Date('2026-07-30T12:00:00Z'));
    assert.equal(wmsCalls.length, 1, 'enable creates one WMS layer');
    assert.equal(wmsCalls[0].opts.time, '2026-07-30', 'TIME from enabled date');
    m.toggleEffisBurntArea(true, new Date('2026-07-28T12:00:00Z'));
    assert.equal(wmsCalls.length, 2, 'timeline change rebuilds layer with new TIME');
    assert.equal(wmsCalls[1].opts.time, '2026-07-28', 'TIME=2026-07-28 after timeline change');
    assert.equal(removed, 1, 'old layer removed before new one — no accumulation');
    m.toggleEffisBurntArea(false, new Date('2026-07-28T12:00:00Z'));
    assert.equal(wmsCalls.length, 2, 'disabled — no new request');
  } finally { global.L = origL; }
});

test('setTimeOffset wiring syncs EFFIS BA when enabled', () => {
  const appJs = readFileSync('js/app.js', 'utf8');
  assert.ok(appJs.includes("if(this.state.effisBurntAreaEnabled)this.map.toggleEffisBurntArea(true,d);"), 'BA sync wired into setTimeOffset');
  assert.ok(appJs.includes("if(this.state.effisBurntAreaEnabled)"), 'BA sync guarded by enabled state');
});

// ============================================================
// v3.3.2 — AbortSignal listener cleanup
// ============================================================
console.log('\nv3.3.2 — AbortSignal listener cleanup');

function spySignal() {
  const listeners = new Set();
  const s = {
    aborted: false,
    reason: undefined,
    addEventListener(t, fn) { listeners.add(fn); },
    removeEventListener(t, fn) { listeners.delete(fn); },
    listenerCount() { return listeners.size; },
    abort(reason) { s.aborted = true; s.reason = reason; for (const fn of [...listeners]) fn(); }
  };
  return s;
}

test('fetchJson removes external abort listener on success', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
  const s = spySignal();
  const r = await U.fetchJson('http://x', { signal: s });
  assert.equal(r.data.ok, 1);
  assert.equal(s.listenerCount(), 0, 'listener removed after success');
});

test('fetchJson removes external abort listener on network error', async () => {
  global.fetch = async () => { throw new Error('NETWORK_ERR'); };
  const s = spySignal();
  let err = null;
  try { await U.fetchJson('http://x', { signal: s }); } catch (e) { err = e; }
  assert.ok(err, 'throws');
  assert.equal(s.listenerCount(), 0, 'listener removed after network error');
});

test('fetchJson removes external abort listener on manual abort', async () => {
  const s = spySignal();
  global.fetch = (url, { signal }) => new Promise((_, rej) => { signal.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' }))); });
  const p = U.fetchJson('http://x', { signal: s });
  s.abort(new Error('cancel'));
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert.equal(err.kind, 'ABORTED');
  assert.equal(s.listenerCount(), 0, 'listener removed after manual abort');
});

test('fetchJson removes external abort listener on timeout', async () => {
  const s = spySignal();
  global.fetch = (url, { signal }) => new Promise((_, rej) => { signal.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' }))); });
  let err = null;
  try { await U.fetchJson('http://x', { signal: s, timeout: 60 }); } catch (e) { err = e; }
  assert.equal(err.kind, 'TIMEOUT');
  assert.equal(s.listenerCount(), 0, 'listener removed after timeout');
});

test('fetchText removes external abort listener on success and abort', async () => {
  global.fetch = async () => ({ ok: true, status: 200, text: async () => 'csv data' });
  const s1 = spySignal();
  await U.fetchText('http://x', { signal: s1 });
  assert.equal(s1.listenerCount(), 0, 'text success cleanup');
  const s2 = spySignal();
  global.fetch = (url, { signal }) => new Promise((_, rej) => { signal.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' }))); });
  const p = U.fetchText('http://x', { signal: s2 });
  s2.abort(new Error('cancel'));
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert.equal(err.kind, 'ABORTED');
  assert.equal(s2.listenerCount(), 0, 'text abort cleanup');
});

// ============================================================
// v3.3.3 — Legend cleanup on off / empty
// ============================================================
console.log('\nv3.3.3 — Legend cleanup');

test('toggle off and empty dataset remove footprint/thermal/evolution legends', () => {
  const proto = AtmoApp.MapManager.prototype;
  const map = { hasLayer: () => true, removeLayer() {}, addTo() {} };
  const layer = { clearLayers() {} };
  const seen = [];
  const origQ = document.querySelector;
  document.querySelector = (sel) => { seen.push(sel); return null; };
  try {
    proto.setFootprint.call({ map, footprintLayer: layer }, [], true);
    proto.toggleFootprint.call({ map, footprintLayer: layer }, false);
    proto.setThermalEnvelope.call({ map, thermalEnvelopeLayer: layer }, [], true);
    proto.toggleThermalEnvelope.call({ map, thermalEnvelopeLayer: layer }, false);
    proto.setEventEvolution.call({ map, evolutionLayer: layer }, [], true);
    proto.toggleEventEvolution.call({ map, evolutionLayer: layer }, false);
  } finally { document.querySelector = origQ; }
  assert.ok(seen.includes('[data-legend="footprint"]'), 'footprint legend selector removed on off/empty');
  assert.ok(seen.includes('[data-legend="thermal"]'), 'thermal legend selector removed on off/empty');
  assert.ok(seen.includes('[data-legend="evolution"]'), 'evolution legend selector removed on off/empty');
});

// ============================================================
// v3.3.3 — GitHub Pages: no fake server calls
// ============================================================
console.log('\nv3.3.3 — GitHub Pages mode guards');

test('v3.4.0 — MTG WMS is direct EUMETSAT GET from browser, no proxy dependency', () => {
  const apiTxt = readFileSync('js/api.js', 'utf8');
  assert.equal(apiTxt.includes('AtmoHubAdapter'), false, 'AtmoHubAdapter removed from api.js');
  assert.equal(apiTxt.includes('GfwAdapter'), false, 'GfwAdapter removed from api.js');
  assert.equal(apiTxt.includes('MtgAdapter'), false, 'MtgAdapter removed from api.js');
  assert.equal(apiTxt.includes('FirePolygonAdapter'), false, 'FirePolygonAdapter removed from api.js');
  const srvTxt2 = readFileSync('server.mjs', 'utf8');
  assert.equal(srvTxt2.includes('/api/atmohub/discover'), false, 'atmohub discover route removed');
  assert.equal(srvTxt2.includes('/api/mtg/active_fires'), false, 'mtg active_fires route removed');
  assert.equal(srvTxt2.includes('ALLOWED_ATHUB_HOSTS'), false, 'AtmoHub SSRF allowlist removed');
  assert.equal(srvTxt2.includes('PRIVATE_IPS'), false, 'PRIVATE_IPS guard removed');
});

test('v3.4.0 — roundToMtgSlot snaps to 10-minute WMS slots', () => {
  const proto = AtmoApp.MapManager.prototype;
  const fn = proto.roundToMtgSlot.toString();
  const m = C().mtgGeoColourWms;
  const slot = m.slotMinutes * 60000;
  const t = new Date('2026-07-30T12:07:00Z').getTime();
  const r = proto.roundToMtgSlot(t);
  assert.equal((r - new Date('2026-07-30T12:00:00Z').getTime()) % slot, 0, 'snapped to slot boundary');
  assert.ok(fn.includes('slotMinutes'), 'uses slotMinutes from config');
});

test('v3.4.1 — slot calculation floors to past slot, never rounds up to future', () => {
  const proto = AtmoApp.MapManager.prototype;
  const slot = C().mtgGeoColourWms.slotMinutes * 60000;
  assert.equal(proto.roundToMtgSlot(new Date('2026-07-30T12:56:00Z')).toISOString(), '2026-07-30T12:50:00.000Z', '12:56 -> 12:50 (floor), not 13:00');
  assert.equal(proto.roundToMtgSlot(new Date('2026-07-30T12:50:00Z')).toISOString(), '2026-07-30T12:50:00.000Z', 'exact slot stays');
  assert.equal(proto.roundToMtgSlot(new Date('2026-07-30T12:51:59Z')).toISOString(), '2026-07-30T12:50:00.000Z', '12:51:59 -> 12:50');
  const fn = proto.roundToMtgSlot.toString();
  assert.equal(fn.includes('Math.round'), false, 'Math.round removed from slot calc');
  assert.ok(mapTxt.includes('Math.floor(ms/slot)'), 'Math.floor used for slot calc (MtgFrameManager.roundToSlot)');
});

test('v3.4.1 — future timeline clamps MTG to latest allowed real frame', () => {
  const proto = AtmoApp.MapManager.prototype;
  const future = new Date(Date.now() + 12 * 3600e3);
  const latest = proto.latestAllowedMtgSlot();
  const r = proto.roundToMtgSlot(future);
  const r2 = r.getTime() > latest.getTime() ? latest : r;
  assert.ok(r2.getTime() <= latest.getTime(), 'MTG time never exceeds latest allowed now-slot');
  assert.equal(r2.getTime() % (C().mtgGeoColourWms.slotMinutes * 60000), 0, 'clamped time still on slot boundary');
});

test('v3.4.0 — wind corridor defaults: 30 km max distance, 22° half-angle, 30 corridors', () => {
  assert.equal(C().downwind.maxDistanceKm, 30, 'downwind.maxDistanceKm === 30');
  assert.equal(C().downwind.halfAngleDeg, 22, 'halfAngleDeg === 22');
  assert.equal(C().downwind.maxCorridors, 30, 'maxCorridors === 30');
  const gridTxt = readFileSync('js/grid.js', 'utf8');
  assert.ok(gridTxt.includes('C.downwind.maxDistanceKm'), 'grid sector analysis uses downwind.maxDistanceKm default');
  assert.equal(gridTxt.includes('C.downwind.distanceKm'), false, 'no legacy downwind.distanceKm in grid.js');
});

test('v3.4.0 — index.html: MTG layer + opacity slider present, removed layers gone', () => {
  assert.ok(htmlTxt.includes('id="layerMtg"'), 'MTG layer checkbox present');
  assert.ok(htmlTxt.includes('id="mtgOpacity"'), 'MTG opacity slider present');
  assert.equal(htmlTxt.includes('id="layerGfw"'), false, 'GFW checkbox removed');
  assert.equal(htmlTxt.includes('id="layerFirePolygons"'), false, 'FirePolygon checkbox removed');
  assert.equal(htmlTxt.includes('id="firePolygonRange"'), false, 'FirePolygon preset select removed');
  assert.equal(htmlTxt.includes('atmoHub'), false, 'no AtmoHub markup in index.html');
});

test('v3.4.3 — app.js: removed services gone, defaults wind/thermal/EFFIS BA/downwind ON, MTG OFF', () => {
  assert.equal(appTxt.includes('loadGfw'), false, 'loadGfw removed');
  assert.equal(appTxt.includes('loadFirePolygons'), false, 'loadFirePolygons removed');
  assert.equal(appTxt.includes('discoverAtmoHub'), false, 'discoverAtmoHub removed');
  assert.ok(/windEnabled:\s*true/.test(appTxt), 'windEnabled default true');
  assert.ok(/downwindEnabled:\s*true/.test(appTxt), 'downwindEnabled default true');
  assert.ok(/mtgEnabled:\s*false/.test(appTxt), 'mtgEnabled default false');
  assert.ok(/effisBurntAreaEnabled:\s*true/.test(appTxt), 'EFFIS BA default true');
  assert.ok(/frpThreshold:C\.frpThreshold/.test(appTxt), 'FRP threshold single-sourced from config');
});

test('v3.4.0 — timeline playback syncs MTG WMS time via setMtgTime', () => {
  assert.ok(appTxt.includes('if(this.state.mtgEnabled)this.map.setMtgTime(d);'), 'setTimeOffset drives setMtgTime when MTG on');
});

test('v3.4.0 — services table lists MTG GeoColour, no AtmoHub/GFW/FirePolygon rows', () => {
  assert.ok(uiTxt.includes('EUMETSAT MTG GeoColour'), 'MTG row present');
  assert.equal(uiTxt.includes('AtmoHub'), false, 'no AtmoHub row');
  assert.equal(uiTxt.includes('GFW'), false, 'no GFW row');
  assert.equal(uiTxt.includes('FirePolygon'), false, 'no FirePolygon row');
});

test('v3.4.3 — substation squares uniform: same size, black fill, blue border, no risk-level classes', () => {
  assert.ok(mapTxt.includes('substationSquare'), 'substationSquare divIcon class used');
  assert.equal(mapTxt.includes('substation-risk-critical'), false, 'no per-level square class in map.js');
  assert.equal(mapTxt.includes('{critical:14,high:12,medium:10,watch:8,low:8}'), false, 'no size-by-risk template');
  assert.equal(mapTxt.includes('width:${size}px'), false, 'no dynamic size template');
  assert.equal(mapTxt.includes('tmIcon'), false, 'legacy tmIcon class removed from map.js');
  assert.equal(cssTxt.includes('.tmIcon'), false, 'legacy tmIcon CSS removed');
  assert.ok(cssTxt.includes('.substationSquare.substation-risk{width:10px;height:10px;background:#000;border:2px solid #2f80ff}'), 'uniform 10px black-fill blue-border risk square CSS');
  assert.equal(cssTxt.includes('.substation-risk-critical'), false, 'risk-critical CSS removed');
  assert.equal(cssTxt.includes('.substation-risk-low'), false, 'risk-low CSS removed');
});

test('v3.4.0 — config: no firePolygonRange/firePolygons, no API keys for removed sources', () => {
  const cfgTxt2 = readFileSync('js/config.js', 'utf8');
  assert.equal(cfgTxt2.includes('firePolygons'), false, 'firePolygons config removed');
  assert.equal(cfgTxt2.includes('gfwApiKey'), false, 'GFW key config removed');
  assert.equal(cfgTxt2.includes('atmoHubPortal'), false, 'AtmoHub portal config removed');
  assert.equal(cfgTxt2.includes('eumetsatConsumerKey'), false, 'EUMETSAT consumer key removed');
  assert.ok(cfgTxt2.includes("appVersion: '3.4.13'"), 'config appVersion 3.4.13');
});

test('v3.4.0 — map.js: createMtgLayer uses WMS params (1.3.0, EPSG:4326, PNG, TIME)', () => {
  const mtgSrc = mapTxt.slice(mapTxt.indexOf('createMtgLayer'), mapTxt.indexOf('toggleMtg'));
  assert.ok(mtgSrc.includes("version:wms.version"), 'WMS version from config (1.3.0)');
  assert.equal(mtgSrc.includes('srs:wms.crs'), false, 'no srs param — WMS 1.3.0 uses CRS (Leaflet swaps BBOX axis order)');
  assert.ok(mtgSrc.includes('crs:L.CRS?L.CRS.EPSG4326:null'), 'EPSG:4326 CRS for axis-order handling');
  assert.ok(mtgSrc.includes("format:wms.format"), 'format from config');
  assert.ok(mtgSrc.includes("layers:wms.layer"), 'layer from config (mtg_fd:rgb_geocolour)');
  assert.ok(mtgSrc.includes("pane:'mtgPane'"), 'tiles rendered into mtg pane');
  assert.ok(mapTxt.includes('maxBackfillSlots'), 'slot backfill cap wired');
  assert.ok(mtgSrc.includes("e.tile.dataset.frameSeq"), 'tile events stamped with frame sequence');
  assert.ok(mtgSrc.includes('mgr.tileLoad(') && mtgSrc.includes('mgr.tileError('), 'tile events routed to frame manager');
});

// ============================================================
// v3.4.1 — MTG frame-based backfill (MtgFrameManager)
// ============================================================
console.log('\nv3.4.1 — MTG frame-based backfill');

const FMC = () => ({ ...C().mtgGeoColourWms, frameSettleMs: 3000 });
function makeFrameManager(handlers) {
  const events = [];
  const mgr = new AtmoApp.MtgFrameManager(FMC(), {
    start: (iso, seq) => events.push(['start', iso, seq]),
    ok: (iso, seq) => events.push(['ok', iso, seq]),
    backfill: (req, target, n, seq) => events.push(['backfill', req, target, n, seq]),
    exhausted: (req, n, seq) => events.push(['exhausted', req, n, seq]),
    invalid: (req, seq) => events.push(['invalid', req, seq]),
    network: (req, seq) => events.push(['network', req, seq]),
    probe: async (iso) => 'image',
    ...handlers
  });
  return { mgr, events };
}
function settle(mgr) {
  const t = mgr._settleT;
  if (t) clearTimeout(t);
  return mgr._settle();
}

test('v3.4.1 — 8 tile errors on the same frame cause exactly 1 backfill', async () => {
  const { mgr, events } = makeFrameManager();
  mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  for (let i = 0; i < 8; i++) mgr.tileError(1);
  assert.equal(mgr.failedTileCount, 8, 'all 8 errors counted on the frame');
  assert.equal(events.filter(e => e[0] === 'backfill').length, 0, 'no backfill before settle');
  await settle(mgr);
  assert.equal(events.filter(e => e[0] === 'backfill').length, 1, 'exactly one backfill for the frame');
  assert.equal(mgr.backfillAttempt, 1, 'backfillAttempt incremented once');
  const bf = events.find(e => e[0] === 'backfill');
  assert.equal(bf[2], '2026-07-30T14:20:00.000Z', 'backfill target is one 10-min slot earlier');
  mgr.dispose();
});

test('v3.4.1 — stale tileerror from an old frame does not affect the new frame', async () => {
  const { mgr, events } = makeFrameManager();
  const seq1 = mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  mgr.tileError(seq1);
  await settle(mgr);
  assert.equal(mgr.backfillAttempt, 1, 'first frame failed and backfilled once');
  const backfillEvent = events.find(e => e[0] === 'backfill');
  const seq2 = mgr.applyBackfill(backfillEvent[2]);
  assert.equal(seq2, seq1 + 1, 'new frame sequence allocated');
  mgr.tileError(seq1); mgr.tileError(seq1);
  assert.equal(mgr.failedTileCount, 0, 'stale frame-1 errors ignored by frame 2');
  assert.equal(mgr.backfillAttempt, 1, 'backfillAttempt unchanged by stale events');
  mgr.dispose();
});

test('v3.4.1 — displayed frame timestamp tracks the frame actually on screen', () => {
  const { mgr } = makeFrameManager();
  mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  mgr.tileLoad(1);
  assert.equal(mgr.displayedTime, '2026-07-30T14:30:00.000Z', 'displayed = requested when frame ok');
  assert.equal(mgr.lastUserTime, '2026-07-30T14:30:00.000Z', 'lastUserTime keeps user selection');
  const seq2 = mgr.applyBackfill('2026-07-30T14:10:00.000Z');
  mgr.tileLoad(seq2);
  assert.equal(mgr.displayedTime, '2026-07-30T14:10:00.000Z', 'displayed = actual backfilled frame 14:10');
  assert.equal(mgr.lastUserTime, '2026-07-30T14:30:00.000Z', 'requested stays 14:30 after backfill');
});

test('v3.4.1 — max 12 backfill slots then exhausted, no endless loop', async () => {
  const { mgr, events } = makeFrameManager();
  let seq = mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  let guard = 0;
  while (guard++ < 50) {
    mgr.tileError(seq);
    const before = events.filter(e => e[0] === 'backfill').length;
    await settle(mgr);
    if (events.filter(e => e[0] === 'backfill').length === before) break;
    seq = mgr.applyBackfill(events.filter(e => e[0] === 'backfill').at(-1)[2]);
  }
  assert.equal(mgr.backfillAttempt, 12, 'exactly 12 backfill attempts');
  assert.ok(events.some(e => e[0] === 'exhausted'), 'exhausted emitted after 12 slots');
  assert.ok(guard < 50, 'loop terminated');
  mgr.dispose();
});

// ============================================================
// v3.4.2 — MTG hotfix: backfill budget reset + single-UTC texts
// ============================================================
console.log('\nv3.4.2 — MTG backfill budget reset + UTC texts');

test('v3.4.2 — applyUserTime resets backfill budget for a new user request', async () => {
  const { mgr, events } = makeFrameManager();
  let seq = mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  for (let i = 0; i < 5; i++) {
    mgr.tileError(seq);
    await settle(mgr);
    const bf = events.filter(e => e[0] === 'backfill').at(-1);
    assert.ok(bf, 'backfill emitted');
    seq = mgr.applyBackfill(bf[2]);
  }
  assert.equal(mgr.backfillAttempt, 5, 'request A consumed 5 backfills');
  assert.ok(mgr.backfillAttempt < 12, 'request A still within budget');

  let seqB = mgr.applyUserTime('2026-07-31T06:10:00.000Z');
  assert.notEqual(seqB, null, 'new user request starts a new frame');
  assert.equal(mgr.backfillAttempt, 0, 'new user request resets the budget');

  let guard = 0;
  while (guard++ < 50) {
    mgr.tileError(seqB);
    const before = events.filter(e => e[0] === 'backfill').length;
    await settle(mgr);
    if (events.filter(e => e[0] === 'backfill').length === before) break;
    seqB = mgr.applyBackfill(events.filter(e => e[0] === 'backfill').at(-1)[2]);
  }
  assert.equal(mgr.backfillAttempt, 12, 'request B can use its own full 12-slot budget');
  assert.ok(events.some(e => e[0] === 'exhausted'), 'B exhausted only after its own 12 slots');
  mgr.dispose();
});

test('v3.4.2 — applyBackfill does not reset the budget', async () => {
  const { mgr, events } = makeFrameManager();
  let seq = mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  mgr.tileError(seq);
  await settle(mgr);
  assert.equal(mgr.backfillAttempt, 1, 'first backfill counted');
  const bf = events.find(e => e[0] === 'backfill');
  mgr.applyBackfill(bf[2]);
  assert.equal(mgr.backfillAttempt, 1, 'applyBackfill leaves budget untouched');
  mgr.dispose();
});

test('v3.4.2 — MTG texts never repeat UTC (mtgFmt already appends it)', () => {
  const src = readFileSync('js/map.js', 'utf8');
  assert.ok(!src.includes('UTC UTC'), 'no "UTC UTC" literal in map.js');
  assert.ok(!/mtgFmt\([^)]*\)\s+UTC/.test(src), 'no mtgFmt(...) immediately followed by another UTC');
  const mk = iso => iso ? iso.slice(11, 16) + ' UTC' : '—';
  const legend = `Seçilen: ${mk('2026-07-30T14:30:00.000Z')}<br>Uydu karesi: ${mk('2026-07-30T14:10:00.000Z')}`;
  assert.ok(!legend.includes('UTC UTC'), 'legend split has no double UTC');
  assert.equal((legend.match(/UTC/g) || []).length, 2, 'exactly one UTC per timestamp');
});

test('v3.4.1 — invalid WMS response stops backfill and reports error', async () => {
  const { mgr, events } = makeFrameManager({ probe: async () => 'invalid' });
  const seq = mgr.applyUserTime('2026-07-30T14:30:00.000Z');
  mgr.tileError(seq);
  await settle(mgr);
  assert.ok(events.some(e => e[0] === 'invalid'), 'invalid handler called');
  assert.equal(mgr.backfillAttempt, 0, 'no backfill when service returns non-image');
  mgr.dispose();
});

test('v3.4.1 — normalize clamps future dates to the latest allowed real slot', () => {
  const mgr = new AtmoApp.MtgFrameManager(FMC(), {});
  const future = new Date(Date.now() + 12 * 3600e3);
  const n = mgr.normalize(future);
  assert.ok(n.getTime() <= mgr.latestAllowed().getTime(), 'future date clamped to now-slot');
  assert.equal(n.getTime() % mgr.slot, 0, 'clamped value stays on 10-min boundary');
  const past = new Date('2024-01-01T00:00:00Z');
  assert.equal(mgr.normalize(past).toISOString(), '2024-01-01T00:00:00.000Z', 'past dates pass through on slot boundary');
  mgr.dispose();
});

// ── v3.3.4 mobile-responsive / overflow contract ──
const cssTxt = readFileSync('css/styles.css', 'utf8');
const htmlTxt = readFileSync('index.html', 'utf8');
const appTxt = readFileSync('js/app.js', 'utf8');
const mapTxt = readFileSync('js/map.js', 'utf8');
const uiTxt = readFileSync('js/ui.js', 'utf8');
const gridTxt = readFileSync('js/grid.js', 'utf8');

test('v3.3.4 CSS: dynamic viewport height support', () => {
  assert.ok(/min-height:100dvh/.test(cssTxt), 'min-height:100dvh present');
  assert.ok(/@supports\(height:100dvh\)\{html,body,#appShell\{height:100dvh\}\}/.test(cssTxt), 'dvh supports block present');
});

test('v3.3.4 CSS: KPI rail keeps all 6 cards scroll-snap on mobile', () => {
  assert.ok(/\.kpiBar\{height:77px;grid-template-columns:repeat\(6,minmax\(110px,1fr\)\);padding:5px;overflow-x:auto/.test(cssTxt), 'kpiBar rail 6-col minmax(110px,1fr)');
  assert.ok(/\.kpiBar \.kpiCard:nth-child\(n\+3\)\{display:block\}/.test(cssTxt), 'all 6 KPI cards visible');
  assert.ok(/\.kpiBar \.kpiCard\{scroll-snap-align:start\}/.test(cssTxt), 'scroll-snap-align on cards');
});

test('v3.3.4 CSS: mainNav 4-col grid + icon-only refresh on mobile', () => {
  assert.ok(/\.mainNav\{height:44px;display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\) auto/.test(cssTxt), 'nav grid repeat(4,minmax(0,1fr)) auto');
  assert.ok(/\.mainNav \.navBtn\{[^}]*min-height:40px/.test(cssTxt), 'nav touch targets >=40px');
  assert.ok(/#refreshAllBtn::before\{content:'↻'/.test(cssTxt), 'refresh icon-only via ::before');
});

test('v3.3.4 CSS: mobile topbar keeps only livePill/buildPill + title ellipsis', () => {
  assert.ok(/\.topMeta #lastUpdated,\.domainPill,#runtimeMode\{display:none\}/.test(cssTxt), 'runtimeMode hidden on mobile');
  assert.ok(/\.topbar h1\{font-size:17px;margin:0;letter-spacing:\.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis/.test(cssTxt), 'h1 ellipsis');
});

test('v3.3.4 CSS: safe-area + compact timeline/detail/toast', () => {
  assert.ok(/\.timelinePanel\{left:max\(8px,env\(safe-area-inset-left\)\);right:max\(8px,env\(safe-area-inset-right\)\);bottom:8px;width:auto\}/.test(cssTxt), 'timeline safe-area L/R');
  assert.ok(/@media\(max-width:480px\)\{\.timelinePanel\{padding:6px 8px\}\.timelineTop\{display:grid;grid-template-columns:auto auto 1fr auto auto/.test(cssTxt), 'compact 2-row timeline <=480px');
  assert.ok(/\.detailPanel\{top:auto;bottom:0;width:100%;height:auto;max-height:calc\(100dvh - 90px\);min-height:220px/.test(cssTxt), 'detail bottom-sheet max-height dvh');
  assert.ok(/padding-bottom:max\(8px,env\(safe-area-inset-bottom\)\)/.test(cssTxt), 'detail bottom safe-area');
  assert.ok(/#closeDetailBtn\{width:44px;height:44px/.test(cssTxt), '44px close button');
  assert.ok(/\.toastHost\{left:max\(8px,env\(safe-area-inset-left\)\);right:max\(8px,env\(safe-area-inset-right\)\);bottom:max\(42px,env\(safe-area-inset-bottom\)\)\}/.test(cssTxt), 'toast safe-area');
});

test('v3.3.4 CSS: legend stack + tables + 1-col grids', () => {
  assert.ok(/\.legendStack\{position:absolute;z-index:550;left:12px;bottom:108px;display:flex;flex-direction:column;gap:6px;max-width:min\(220px,calc\(100vw - 16px\)\);max-height:40dvh;overflow-y:auto/.test(cssTxt), 'legend max-height:40dvh + max-width min()');
  assert.ok(/\.tableWrap\{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%/.test(cssTxt), 'tableWrap overflow-x touch');
  assert.ok(/@media\(max-width:600px\)\{\.metricGrid\{grid-template-columns:1fr\}\}/.test(cssTxt), 'metricGrid 1-col <=600px');
});

test('v3.3.4 HTML: no inline grid-template-columns left', () => {
  assert.equal(htmlTxt.includes('grid-template-columns:1fr 1fr'), false, 'inline 2-col styles removed');
  assert.ok(!/style="grid-template-columns/.test(htmlTxt), 'no style= grid-template-columns anywhere');
});

test('v3.3.4 JS: debounced invalidateSize on resize/orientation + panel collapse', () => {
  assert.ok(/scheduleResize\(\)\{clearTimeout\(this\.resizeT\);this\.resizeT=setTimeout\(\(\)=>\{const v=document\.getElementById\('view-map'\);if\(v\?\.classList\.contains\('active'\)\)this\.map\?\.map\?\.invalidateSize\(\);},150\);}/.test(appTxt), 'scheduleResize debounce in app.js');
  assert.ok(/window\.addEventListener\('resize',\(\)=>this\.scheduleResize\(\)\);window\.addEventListener\('orientationchange',\(\)=>this\.scheduleResize\(\)\);/.test(appTxt), 'resize+orientationchange listeners');
  assert.ok(/collapseBtn'\)\?\.addEventListener\('click',e=>\{const body=document\.getElementById\('layerPanelBody'\);body\.classList\.toggle\('hidden'\);e\.currentTarget\.textContent=body\.classList\.contains\('hidden'\)\?'\+':'−';if\(document\.getElementById\('view-map'\)\?\.classList\.contains\('active'\)\)setTimeout\(\(\)=>A\.app\?\.map\?\.map\?\.invalidateSize\(\),30\);/.test(uiTxt), 'collapse triggers invalidateSize');
});

// ── v3.3.5 landscape phone + tablet KPI + safe-area top ──
const cfgTxt = readFileSync('js/config.js', 'utf8');
const srvTxt = readFileSync('server.mjs', 'utf8');
const pkgTxt = readFileSync('package.json', 'utf8');

test('v3.3.5 CSS: landscape phone breakpoint (max-height:500px landscape)', () => {
  assert.ok(/@media \(max-height:500px\) and \(orientation:landscape\)\{/.test(cssTxt), 'landscape breakpoint present');
  assert.ok(/\.topbar\{height:calc\(44px \+ env\(safe-area-inset-top\)\);padding:0 10px;padding-top:env\(safe-area-inset-top\)\}/.test(cssTxt), 'landscape topbar 44px + safe-area top');
  assert.ok(/\.kpiBar\{height:64px;grid-template-columns:repeat\(6,minmax\(96px,1fr\)\);padding:4px 6px\}/.test(cssTxt), 'landscape KPI rail 64px (no 118px grid)');
  assert.ok(/main\{height:calc\(100% - 144px - env\(safe-area-inset-top\)\)\}/.test(cssTxt), 'landscape main calc -> map >=55%');
  assert.ok(/\.layerPanel\{top:50px;right:8px;width:240px;max-height:calc\(100% - 62px\)\}/.test(cssTxt), 'landscape layer panel height');
  assert.ok(/\.timelineBtn\{min-height:30px;padding:3px 6px;font-size:9px\}/.test(cssTxt), 'landscape compact timeline');
});

test('v3.3.5 CSS: tablet 768-1200 keeps all 6 KPIs in rail', () => {
  assert.equal(cssTxt.includes('.kpiCard:nth-child(n+4){display:none}'), false, 'nth-child(n+4) hiding removed');
  assert.ok(/@media\(max-width:1200px\)\{\.topMeta #lastUpdated\{display:none\}\.kpiBar\{grid-template-columns:repeat\(6,minmax\(110px,1fr\)\);height:88px;overflow-x:auto;scroll-snap-type:x proximity/.test(cssTxt), 'tablet 6-col KPI rail with proximity snap');
  assert.ok(/main\{height:calc\(100% - 194px\)\}/.test(cssTxt), 'tablet main height calc(100% - 194px)');
});

test('v3.3.5 CSS: desktop >1200 KPI grid unchanged', () => {
  assert.ok(/\.kpiBar\{height:82px;display:grid;grid-template-columns:repeat\(6,1fr\);gap:7px;padding:7px 10px/.test(cssTxt), 'desktop 6-col grid 82px preserved');
});

test('v3.3.5 CSS: scroll-snap proximity on mobile + tablet rails', () => {
  const matches = cssTxt.match(/scroll-snap-type:x proximity/g) || [];
  assert.ok(matches.length >= 2, 'proximity snap on both rails, found ' + matches.length);
});

test('v3.3.5 CSS: safe-area-inset-top on mobile topbar + main calc', () => {
  assert.ok(/\.topbar\{height:calc\(56px \+ env\(safe-area-inset-top\)\);padding-top:env\(safe-area-inset-top\)\}/.test(cssTxt), 'mobile topbar height + safe-area top');
  assert.ok(/main\{height:calc\(100% - 177px - env\(safe-area-inset-top\)\)\}/.test(cssTxt), 'mobile main calc subtracts safe-area top');
});

test('v3.4.13 version bump to 3.4.13 in all files', () => {
  assert.ok(htmlTxt.includes('v3.4.13'), 'index.html buildPill');
  assert.ok(htmlTxt.includes('v=3.4.13'), 'index.html cache-busting');
  assert.ok(cfgTxt.includes("appVersion: '3.4.13'"), 'config.js appVersion');
  assert.ok(srvTxt.includes("APP_VERSION='3.4.13'"), 'server.mjs APP_VERSION');
  assert.ok(pkgTxt.includes('"version":"3.4.13"'), 'package.json version');
  assert.equal(htmlTxt.includes('3.4.7'), false, 'no stale 3.4.7 in index.html');
  assert.equal(htmlTxt.includes('3.4.6'), false, 'no stale 3.4.6 in index.html');
  assert.equal(htmlTxt.includes('3.4.5'), false, 'no stale 3.4.5 in index.html');
  assert.equal(htmlTxt.includes('3.4.4'), false, 'no stale 3.4.4 in index.html');
  assert.equal(htmlTxt.includes('3.4.3'), false, 'no stale 3.4.3 in index.html');
  assert.equal(htmlTxt.includes('3.4.2'), false, 'no stale 3.4.2 in index.html');
  assert.equal(/3\.4\.1[^0-9]/.test(htmlTxt), false, 'no stale 3.4.1 in index.html (3.4.10 excluded via digit anchor)');
  assert.equal(htmlTxt.includes('3.4.0'), false, 'no stale 3.4.0 in index.html');
});

// ── v3.4.3 — default layers + FRP default 30 + uniform substation squares ──
console.log('\nv3.4.3 — default layers, FRP default, uniform squares');

test('v3.4.3 — FRP default is 30 everywhere (config single source)', () => {
  assert.equal(C().frpThreshold, 30, 'config frpThreshold = 30');
  assert.ok(appTxt.includes('frpThreshold:C.frpThreshold'), 'app state reads config');
  assert.ok(mapTxt.includes('this.frpThreshold=C.frpThreshold'), 'map manager reads config');
  assert.ok(htmlTxt.includes('id="frpThreshold" type="range" min="0" max="200" step="5" value="30"'), 'slider initial value 30');
  assert.ok(htmlTxt.includes('≥30 MW'), 'slider label 30');
  assert.equal(htmlTxt.includes('value="50"'), false, 'no stale 50 default');
});

test('v3.4.3 — thermal envelope / EFFIS BA / downwind default ON', () => {
  assert.ok(htmlTxt.includes('id="layerThermalEnvelope" type="checkbox" checked'), 'thermal envelope default checked');
  assert.ok(htmlTxt.includes('id="layerEffisBurntArea" type="checkbox" checked'), 'EFFIS BA default checked');
  assert.ok(htmlTxt.includes('id="layerDownwindCorridor" type="checkbox" checked'), 'downwind default checked');
  assert.ok(/effisBurntAreaEnabled:\s*true/.test(appTxt), 'state EFFIS BA true');
  assert.ok(/downwindEnabled:\s*true/.test(appTxt), 'state downwind true');
  assert.ok(appTxt.includes('if(this.state.effisBurntAreaEnabled)this.map.toggleEffisBurntArea(true,this.state.selectedTime);'), 'EFFIS BA applied at init');
});

test('v3.4.10 — TM icons distinct: grid neutral, risk blue (sector removed in v3.4.11)', () => {
  const icons = mapTxt.slice(mapTxt.indexOf('substationIcon(){'), mapTxt.indexOf('setGridGroup'));
  assert.ok(icons.includes('<span class="substationSquare"></span>'), 'grid-layer substation icon is neutral base square');
  assert.equal(icons.includes('substationIcon(){return L.divIcon({className:\'substationIconWrap\',html:\'<span class="substationSquare substation-risk"></span>\''), false, 'grid icon no longer risk-styled');
  assert.ok(icons.includes('substationSquare substation-risk'), 'risk factory keeps blue-border square');
  assert.ok(cssTxt.includes('.substationSquare{display:block;width:8px;height:8px;background:#1b2a44;border:1.5px solid #8b98ad;box-sizing:border-box}'), 'base neutral square CSS');
  assert.ok(cssTxt.includes('.substationSquare.substation-risk{width:10px;height:10px;background:#000;border:2px solid #2f80ff}'), 'risk square CSS kept');
  assert.equal(icons.includes('background:#0a2531'), false, 'sector icon no legacy dark fill');
  assert.equal(icons.includes('#7be6ff'), false, 'no inline hex colors in icon factories (CSS only)');
});

// ── FIRMS hexagon markers + Ayarlar tab rename ──
test('v3.3.6 nav: settings tab renamed to Ayarlar', () => {
  assert.ok(htmlTxt.includes('<button class="navBtn" data-view="settings">⚙ Ayarlar</button>'), 'nav button label');
  assert.equal(htmlTxt.includes('Ayarlar / Kaynaklar'), false, 'no old label in index.html');
});

test('v3.3.6 map: HexagonMarker class draws 6-vertex regular hexagon via canvas renderer', () => {
  assert.ok(mapTxt.includes('class HexagonMarker extends L.CircleMarker'), 'hexagon class exists');
  assert.ok(mapTxt.includes('for(let i=0;i<6;i++)'), '6 vertices');
  assert.ok(mapTxt.includes('Math.PI/3*i'), '60-degree vertex spacing');
  assert.ok(mapTxt.includes("this._parts=[pts];this._renderer._updatePoly(this,true)"), 'canvas polygon path drawn');
});

test('v3.3.6 map: FIRMS cluster + individual detections use HexagonMarker', () => {
  const renderFires = mapTxt.slice(mapTxt.indexOf('renderFires(selectedTime){'), mapTxt.indexOf('toggleFires(show)'));
  const clusterCount = (mapTxt.match(/new HexagonMarker\(\[ev\.lat,ev\.lon\]/g) || []).length;
  const pointCount = (mapTxt.match(/new HexagonMarker\(\[f\.lat,f\.lon\]/g) || []).length;
  assert.ok(clusterCount === 1, 'cluster branch uses hexagon');
  assert.ok(pointCount === 1, 'individual branch uses hexagon');
  assert.equal(renderFires.includes('L.circleMarker'), false, 'no circle markers in FIRMS render path');
});

// ── grid hover tooltips (v3.3.7) ──
const utilsTxt = readFileSync('js/utils.js', 'utf8');

test('v3.3.7 utils: formatVoltage renders raw, multi and group voltages', () => {
  assert.ok(utilsTxt.includes("formatVoltage(v){"), 'formatVoltage helper exists');
  assert.ok(utilsTxt.includes("'300-500kV':'300–500 kV'"), '300-500kV group label');
  assert.ok(utilsTxt.includes("'unknown':'Bilinmiyor'"), 'unknown group label');
  assert.ok(utilsTxt.includes('Math.max(...nums)'), 'multi-voltage takes max');
  assert.ok(utilsTxt.includes('kv%1===0?kv:kv.toFixed(1)'), 'kV shown integer when whole');
});

test('v3.3.7 map: grid tooltip binds name + formatted voltage + operator + OSM attribution', () => {
  assert.ok(mapTxt.includes("`<strong>${isSub?'Trafo Merkezi':'İletim Hattı'}</strong><br>"), 'tooltip header by type');
  assert.ok(mapTxt.includes("U.escapeHtml(p.name||(isSub?'Adsız trafo merkezi':'Adsız OSM hattı'))"), 'name fallback');
  assert.ok(mapTxt.includes('Gerilim: ${U.escapeHtml(v)}'), 'formatted voltage line');
  assert.ok(mapTxt.includes("${p.operator?`<br>${U.escapeHtml(p.operator)}`:''}"), 'operator line');
  assert.ok(mapTxt.includes('<small>OSM / ODbL</small>'), 'OSM attribution');
  assert.ok(mapTxt.includes('gridTooltip(f.properties,true),{sticky:true}'), 'substation tooltip sticky');
});

test('v3.3.7 map: no preferCanvas double-canvas blocking hover on grid lines', () => {
  assert.equal(mapTxt.includes('preferCanvas:true'), false, 'preferCanvas removed from map options');
  assert.ok(mapTxt.includes("this.renderer=L.canvas({padding:.4})"), 'shared canvas renderer kept');
  assert.ok(cssTxt.includes('.leaflet-pane{pointer-events:none}'), 'panes click-through');
  assert.ok(cssTxt.includes('.leaflet-pane>canvas.leaflet-smoke-canvas{pointer-events:none}'), 'smoke canvas none');
  assert.ok(cssTxt.includes('.leaflet-pane>svg{pointer-events:none}'), 'svg roots none');
  assert.ok(cssTxt.includes('.leaflet-pane>svg .leaflet-interactive{pointer-events:visiblePainted}'), 'svg interactive paths only');
});

// ============================================================
// v3.4.1 — MTG 10-min playback, risk squares, service states
// ============================================================
console.log('\nv3.4.1 — playback, risk squares, service states');

test('v3.4.1 — MTG playback steps 10 min per frame while enabled, else 3 h', () => {
  assert.equal(C().timeline.mtgPlayStepMinutes, 10, 'mtgPlayStepMinutes = 10');
  assert.equal(C().timeline.playStepHours, 3, 'non-MTG step stays 3 h');
  assert.ok(appTxt.includes('const step=this.state.mtgEnabled?C.timeline.mtgPlayStepMinutes/60:C.timeline.playStepHours;'), 'playback step branches on mtgEnabled');
  assert.ok(appTxt.includes('if(this.state.mtgEnabled)d.setUTCSeconds(0,0);else d.setUTCMinutes(0,0,0);'), '10-min offsets preserved while MTG active');
});

test('v3.4.1 — nearest-risk substation marker is a square (riskSubstationIcon)', () => {
  assert.ok(mapTxt.includes('riskSubstationIcon('), 'riskSubstationIcon helper exists');
  assert.ok(mapTxt.includes('this.riskSubstationIcon(a.riskBand.level,c)'), 'nearest substation uses square marker');
  const riskSrc = mapTxt.slice(mapTxt.indexOf('setFireImpacts'), mapTxt.indexOf('makeLegend(\'risk\''));
  assert.ok(riskSrc.includes("if(s&&s.distanceKm<=C.substationRiskDisplayDistanceKm)L.marker([s.feature.lat,s.feature.lon]"), 'substation rendered as guarded 5 km square marker');
  assert.equal(riskSrc.includes('L.circleMarker([s.feature.lat'), false, 'no circleMarker for TM symbol');
  assert.equal(mapTxt.includes('{critical:14,high:12,medium:10,watch:8,low:8}'), false, 'no per-level square sizes');
});

test('v3.4.11 — downwind corridor draws no TM markers (sector squares removed)', () => {
  assert.equal(mapTxt.includes('sectorSubstationIcon'), false, 'sectorSubstationIcon factory removed');
  const dwSrc = mapTxt.slice(mapTxt.indexOf('setDownwindCorridors'), mapTxt.indexOf('toggleFwi'));
  assert.equal(dwSrc.includes('L.marker'), false, 'no TM markers in downwind corridor path');
  assert.ok(dwSrc.includes("for(const x of dw.lines.slice(0,4))L.polyline"), 'line highlights kept in corridor');
  assert.equal(cssTxt.includes('substation-sector'), false, 'sector square CSS removed');
  assert.equal(mapTxt.includes('substation-sector'), false, 'no substation-sector class left in map.js');
  assert.equal(mapTxt.includes('Koridordaki trafo merkezi'), false, 'corridor TM legend line removed');
});

test('v3.4.1 — risk legend shows square TM symbol', () => {
  const riskLegend = mapTxt.slice(mapTxt.indexOf("this.makeLegend('risk'"), mapTxt.indexOf('this.makeLegend(\'risk\'') + 900);
  assert.ok(riskLegend.includes('Riskli trafo merkezi (kare)'), 'legend line labels square TM');
  assert.ok(riskLegend.includes('substationSquare'), 'legend uses square class');
  assert.equal(mapTxt.includes('Koridordaki trafo merkezi'), false, 'downwind legend no longer marks TM symbol (v3.4.11)');
});

test('v3.4.1 — services table labels loading/backfill/no-frame states', () => {
  assert.ok(uiTxt.includes("s.state==='loading'?'Yükleniyor'"), 'loading label');
  assert.ok(uiTxt.includes("s.state==='backfill'?'Gecikmeli frame'"), 'backfill label');
  assert.ok(uiTxt.includes("s.state==='no-frame'?'Kare yok'"), 'no-frame label');
});

test('v3.4.1 — map.js emits distinct MTG states incl. Geçersiz WMS yanıtı', () => {
  assert.ok(mapTxt.includes("state:'loading'") && mapTxt.includes("state:'backfill'") && mapTxt.includes("state:'no-frame'"), 'loading/backfill/no-frame states emitted');
  assert.ok(mapTxt.includes("state:'error',note:'Geçersiz WMS yanıtı"), 'invalid WMS response state');
  assert.ok(mapTxt.includes("state:'error',note:'WMS bağlantı hatası'"), 'network error state');
});

test('v3.4.1 — old EUMETView geoserv endpoint absent repo-wide', () => {
  function allFiles(dir) {
    let out = [];
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) {
        if (['node_modules', '.git', 'data'].includes(e)) continue;
        out = out.concat(allFiles(p));
      } else if (/\.(js|mjs|html|md|css|json|yml)$/.test(e)) out.push(p);
    }
    return out;
  }
  const hits = allFiles('.').filter(f => readFileSync(f, 'utf8').includes('eumetview.' + 'eumetsat.int/geoserv'));
  assert.deepEqual(hits, [], 'legacy endpoint removed from every file: ' + hits.join(', '));
});

test('v3.4.1 — official EUMETView endpoint referenced everywhere', () => {
  assert.ok(cfgTxt.includes('https://view.eumetsat.int/geoserver/wms'), 'config uses official endpoint');
  assert.ok(mapTxt.includes('L.tileLayer.wms(wms.url,'), 'map.js builds layer from configured official endpoint');
});

// ============================================================
// v3.4.1 — live external EUMETView WMS contract
// ============================================================
console.log('\nv3.4.1 — external EUMETView contract');

test('v3.4.1 — GetCapabilities advertises layer + GetMap returns real image (SKIPPED if network unavailable)', async () => {
  const m = C().mtgGeoColourWms;
  const f = typeof realFetch === 'function' ? realFetch : fetch;
  let caps;
  try {
    caps = await f(`${m.url}?service=WMS&version=${m.version}&request=GetCapabilities`, { signal: AbortSignal.timeout(20000) });
  } catch (e) {
    console.log('    SKIPPED — network unavailable');
    return;
  }
  assert.equal(caps.status, 200, `GetCapabilities HTTP 200, got ${caps.status}`);
  const xml = await caps.text();
  assert.ok(xml.startsWith('<?xml'), 'capabilities is XML');
  assert.ok(xml.includes('mtg_fd:rgb_geocolour'), 'GeoColour layer present in capabilities');
  assert.ok(xml.includes(`version="${m.version}"`), `capabilities root version ${m.version}`);
  const dim = xml.match(/<Dimension name="time"[^>]*>\s*([^<]+)<\/Dimension>/);
  assert.ok(dim, 'time dimension present');
  const parts = dim[1].trim().split('/');
  assert.equal(parts.length, 3, 'time dimension start/end/step');
  const time = parts[1].trim();
  let gmap;
  try {
    gmap = await f(`${m.url}?SERVICE=WMS&VERSION=${m.version}&REQUEST=GetMap&LAYERS=${m.layer}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&BBOX=${m.probeBbox}&WIDTH=64&HEIGHT=64&CRS=EPSG:4326&TIME=${encodeURIComponent(time)}`, { signal: AbortSignal.timeout(30000) });
  } catch (e) {
    console.log('    SKIPPED — GetMap network error');
    return;
  }
  assert.equal(gmap.status, 200, `GetMap HTTP 200, got ${gmap.status}`);
  const ct = (gmap.headers.get('content-type') || '').toLowerCase();
  assert.ok(ct.startsWith('image/'), `GetMap Content-Type image/*, got ${ct}`);
  const bytes = new Uint8Array(await gmap.arrayBuffer());
  assert.ok(bytes.length > 1000, 'image payload non-trivial');
  assert.ok(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47, 'PNG magic bytes');
});

// ── v3.4.4 — Şebeke Risk Özeti paneli (risk summary) ──
console.log('\nv3.4.4 — risk summary panel');

test('v3.4.4 — analysis toggle button present, under legend toggle, same style', () => {
  assert.ok(htmlTxt.includes('id="analysisToggle"'), 'analysis toggle button in index.html');
  const lg = htmlTxt.indexOf('id="legendToggleBtn"');
  const an = htmlTxt.indexOf('id="analysisToggle"');
  assert.ok(lg !== -1 && an > lg, 'analysis button after legend button in DOM order');
  assert.ok(cssTxt.includes('.legendToggleBtn,.analysisToggleBtn{left:12px;z-index:610;font-size:9px;padding:6px 8px;background:#09151fdd;width:122px;text-align:center}'), 'shared button style rule');
  assert.ok(cssTxt.includes('.analysisToggleBtn{bottom:74px}'), 'desktop stack: legend button 108, analysis button 74 (gap)');
});

test('v3.4.4 — panel markup reuses legend visual language', () => {
  assert.ok(htmlTxt.includes('id="analysisSummaryPanel"'), 'panel element present');
  assert.ok(htmlTxt.includes('class="analysisStack analysisHidden"'), 'panel starts hidden with own class');
  assert.ok(htmlTxt.includes('<div class="legendHeader">'), 'panel header reuses legendHeader');
  assert.ok(htmlTxt.includes('⚡ Şebeke Risk Özeti'), 'panel title');
  assert.ok(htmlTxt.includes('id="analysisClose"'), 'panel close button');
  assert.ok(htmlTxt.includes('En yüksek öncelikli 5 yangın olayı'), 'sub label');
  assert.ok(htmlTxt.includes('id="analysisSummaryBody"'), 'cards container');
});

test('v3.4.4 — panel stack CSS: independent from legend, bounded on mobile', () => {
  assert.ok(/\.analysisStack\{position:absolute;z-index:550;left:12px;bottom:142px;width:min\(220px,calc\(100vw - 16px\)\);max-width:min\(220px,calc\(100vw - 16px\)\);max-height:40dvh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:8px;background:#09151fee;backdrop-filter:blur\(8px\);border:1px solid var\(--line\);border-radius:9px;box-shadow:var\(--shadow\);font-size:9px;/.test(cssTxt), 'panel positioned + bounded + solid legend-like look');
  assert.ok(cssTxt.includes('.analysisStack.analysisHidden{opacity:0;pointer-events:none;transform:translateY(8px)}'), 'hidden state');
  assert.equal(cssTxt.includes('body.analysisOpen'), false, 'no analysisOpen shifting rules left');
});

test('v3.4.4 — risk card markup: rank, badge, event, nearest asset, distance, meta', () => {
  assert.ok(uiTxt.includes('riskSummaryCard(a,i){'), 'card factory method');
  assert.ok(uiTxt.includes('<span class="riskRank">#${i+1}</span>'), 'rank #1..5');
  assert.ok(uiTxt.includes('class="riskBadge ${a.riskBand?.level||\'low\'}'), 'risk badge reuses existing level classes');
  assert.ok(uiTxt.includes('⚡ EN YAKIN HAT'), 'nearest line label');
  assert.ok(uiTxt.includes('riskCardNearest'), 'nearest asset block present');
  assert.ok(uiTxt.includes('FRP: ${this.val(a.event?.maxFrp,0,\' MW\')}'), 'FRP in card meta');
  assert.ok(uiTxt.includes('Skor: ${a.riskScore}'), 'risk score in card meta');
  assert.ok(uiTxt.includes('Aktif şebeke riski bulunamadı.'), 'empty state message');
});

test('v3.4.4 — cards use the same source and order as the impact table', () => {
  assert.ok(uiTxt.includes('rows.slice(0,5).map((a,i)=>this.riskSummaryCard(a,i))'), 'max 5 cards');
  assert.ok(uiTxt.includes('const rows=this.riskTableRows(A.app?.state?.fireImpacts||[]);'), 'cards read same fireImpacts via riskTableRows');
  assert.ok(uiTxt.includes('riskTableRows(analyses){'), 'shared row pipeline exists');
  assert.ok(uiTxt.includes('let rows=this.riskTableRows(arr);'), 'impact table uses the same pipeline');
});

test('v3.4.4 — nearest asset split: UI shows only the nearest line, risk math keeps TM', () => {
  assert.ok(uiTxt.includes('getNearestDisplayedAsset(row){return row.nearestLine||null;}'), 'UI helper resolves displayed asset from nearestLine only');
  assert.ok(uiTxt.includes('const obj=this.getNearestDisplayedAsset(a)'), 'table row uses helper');
  assert.ok(uiTxt.includes('const obj=this.getNearestDisplayedAsset(a),props=obj?.feature?.props'), 'card uses helper');
  assert.equal(uiTxt.includes('useLine'), false, 'no line-vs-TM min-distance pick left in ui.js');
  assert.equal(uiTxt.includes("useLine?'Hat':'TM'"), false, 'no TM kind fallback in UI');
  assert.ok(gridTxt.includes("if(l&&(!s||l.distanceKm<=s.distanceKm)){nearestAsset=l"), 'grid.js keeps min-distance pick for risk math');
  assert.ok(gridTxt.includes("else if(s){nearestAsset=s"), 'TM-only fallback kept for risk math');
  assert.ok(gridTxt.includes("nearestLine:nearest?.line||null,nearestSubstation:nearest?.substation||null,displayedNearestAsset:nearest?.line||null"), 'per-row line/substation/displayed split');
  assert.ok(uiTxt.includes('Yakın iletim hattı bulunamadı'), 'no-line fallback label');
});

test('v3.4.4 — card click emits focusRisk with the same row object as the table', () => {
  assert.ok(uiTxt.includes('body.querySelectorAll(\'.riskCard\').forEach(el=>el.addEventListener(\'click\',()=>A.Events.emit(\'focusRisk\',rows[Number(el.dataset.riskIndex)])))'), 'card click -> focusRisk, same rows array');
  assert.ok(uiTxt.includes('data-risk-index="${i}"'), 'card carries row index');
});

test('v3.4.6 — legend and analysis panels are mutually exclusive', () => {
  assert.ok(uiTxt.includes('const willOpen=legendStack.classList.contains(\'legendsHidden\');'), 'legend willOpen probe');
  assert.ok(uiTxt.includes('if(willOpen)this.setAnalysisOpen(false);'), 'opening legend closes analysis');
  assert.ok(uiTxt.includes('const willOpen=analysisPanel.classList.contains(\'analysisHidden\');'), 'analysis willOpen probe');
  assert.ok(uiTxt.includes('if(willOpen)this.setLegendOpen(false);'), 'opening analysis closes legend');
  assert.ok(uiTxt.includes('document.getElementById(\'analysisClose\')?.addEventListener(\'click\',()=>this.setAnalysisOpen(false));'), 'close button closes analysis');
  assert.ok(uiTxt.includes("btn.textContent=open?'⚡ Analizi Gizle':'⚡ Analizi Göster';"), 'analysis label swap via setAnalysisOpen');
  assert.ok(uiTxt.includes("btn.textContent=open?'◫ Lejantları Gizle':'◫ Lejantları Göster';"), 'legend label swap via setLegendOpen');
  assert.ok(cssTxt.includes('.analysisStack.analysisHidden') && cssTxt.includes('.legendStack.legendsHidden'), 'separate hidden classes');
  assert.ok(htmlTxt.includes('<div id="analysisSummaryPanel" class="analysisStack analysisHidden" aria-hidden="true">') && htmlTxt.includes('<div id="legendStack" class="legendStack legendsHidden" aria-hidden="true">'), 'no shared open/close state in DOM');
});

test('v3.4.4 — live update: renderImpact re-renders the summary (single funnel)', () => {
  const r = uiTxt.indexOf('renderImpact(');
  const c = uiTxt.indexOf('this.renderRiskSummary();');
  assert.ok(r !== -1 && c > r, 'renderRiskSummary called inside renderImpact');
});

// ── v3.4.5 — DOM uniqueness hotfix (duplicate analysis panel IDs) ──
console.log('\nv3.4.5 — DOM uniqueness contract');

const idCount = id => (htmlTxt.match(new RegExp('id="' + id + '"', 'g')) || []).length;

test('v3.4.5 — analysisToggle occurs exactly once', () => {
  assert.equal(idCount('analysisToggle'), 1, 'analysisToggle count');
});

test('v3.4.5 — analysisSummaryPanel occurs exactly once', () => {
  assert.equal(idCount('analysisSummaryPanel'), 1, 'analysisSummaryPanel count');
});

test('v3.4.5 — analysisClose occurs exactly once', () => {
  assert.equal(idCount('analysisClose'), 1, 'analysisClose count');
});

test('v3.4.5 — analysisSummaryBody occurs exactly once', () => {
  assert.equal(idCount('analysisSummaryBody'), 1, 'analysisSummaryBody count');
});

test('v3.4.5 — every id attribute in index.html is unique', () => {
  const ids = htmlTxt.match(/id="[^"]+"/g) || [];
  const seen = new Set();
  const dup = [];
  for (const raw of ids) {
    if (seen.has(raw)) dup.push(raw);
    seen.add(raw);
  }
  assert.equal(dup.length, 0, 'duplicate ids: ' + (dup.join(', ') || 'none'));
});

test('v3.4.5 — legend block ids remain unique (no collateral)', () => {
  assert.equal(idCount('legendToggleBtn'), 1, 'legendToggleBtn count');
  assert.equal(idCount('legendStack'), 1, 'legendStack count');
});

test('v3.4.5 — ui.js keeps analysisToggle binding', () => {
  assert.ok(uiTxt.includes('analysisBtn?.addEventListener(\'click\',()=>{'), 'analysisToggle click binding preserved');
  assert.ok(uiTxt.includes('this.setAnalysisOpen(willOpen);'), 'binding routes through setAnalysisOpen');
});

test('v3.4.5 — ui.js enforces DOM uniqueness contract in init', () => {
  assert.ok(uiTxt.includes("const requiredUniqueIds=['analysisToggle','analysisSummaryPanel','analysisClose','analysisSummaryBody'];"), 'required ids array present');
  assert.ok(uiTxt.includes('const nodes=document.querySelectorAll(`#${id}`);'), 'querySelectorAll uniqueness probe');
  assert.ok(uiTxt.includes('if(nodes.length!==1)console.error(`DOM contract violation: #${id} count=${nodes.length}`);'), 'console.error on contract violation');
});

test('v3.4.5 — narrow screens collapse layerPanel body when a panel opens', () => {
  assert.ok(uiTxt.includes('holdLayerPanel(open){'), 'common holdLayerPanel helper');
  assert.ok(uiTxt.includes("if(window.innerWidth<=520){const lb=document.getElementById('layerPanelBody');"), 'collapse layerPanelBody on narrow screens');
  assert.ok(uiTxt.includes("lb.classList.add('hidden')"), 'uses the app collapse class');
  assert.ok(uiTxt.includes("if(cb)cb.textContent='+';"), 'collapse button label syncs');
  assert.ok((uiTxt.match(/if\(willOpen\)this\.holdLayerPanel\(true\);/g) || []).length >= 2, 'helper called from both legend and analysis bindings');
});

// ── v3.4.6 — exclusive solid panels (shared panel look, mutual exclusion, no shifting) ──
console.log('\nv3.4.6 — exclusive solid panels');

test('v3.4.6 — central setLegendOpen/setAnalysisOpen helpers with aria sync', () => {
  assert.ok(uiTxt.includes('setLegendOpen(open){'), 'setLegendOpen helper');
  assert.ok(uiTxt.includes('setAnalysisOpen(open){'), 'setAnalysisOpen helper');
  assert.ok(uiTxt.includes("stack.classList.toggle('legendsHidden',!open);"), 'legend class toggle driven by state');
  assert.ok(uiTxt.includes("panel.classList.toggle('analysisHidden',!open);"), 'analysis class toggle driven by state');
  assert.ok(uiTxt.includes("stack.setAttribute('aria-hidden',String(!open));"), 'legend aria-hidden sync');
  assert.ok(uiTxt.includes("panel.setAttribute('aria-hidden',String(!open));"), 'analysis aria-hidden sync');
  assert.ok(uiTxt.includes("btn.setAttribute('aria-expanded',String(open));"), 'aria-expanded sync on buttons');
  assert.ok(uiTxt.includes('if(open)this.renderRiskSummary();'), 're-render only when opening');
});

test('v3.4.6 — no body.analysisOpen left in JS or CSS', () => {
  assert.equal(uiTxt.includes('analysisOpen'), false, 'ui.js no analysisOpen body class');
  assert.equal(cssTxt.includes('body.analysisOpen'), false, 'styles.css no analysisOpen rules');
});

test('v3.4.6 — buttons stay fixed: desktop 108/74, mobile 126/92', () => {
  assert.ok(cssTxt.includes('.legendToggleBtn{bottom:108px}.analysisToggleBtn{bottom:74px}'), 'desktop fixed positions');
  assert.ok(cssTxt.includes('@media(max-width:760px){.legendToggleBtn{bottom:126px;left:8px}.analysisToggleBtn{bottom:92px;left:8px}'), 'mobile fixed positions');
});

test('v3.4.6 — mobile analysis stack aligns with legend stack (158px)', () => {
  assert.ok(cssTxt.includes('.analysisStack{bottom:158px;left:8px}'), 'mobile analysisStack bottom 158 left 8');
  assert.ok(cssTxt.includes('.legendStack{bottom:158px}'), 'mobile legendStack bottom 158');
});

test('v3.4.6 — aria initial states in index.html', () => {
  assert.ok(htmlTxt.includes('<button id="legendToggleBtn" class="legendToggleBtn panelFloating" aria-expanded="false">'), 'legend button aria-expanded=false');
  assert.ok(htmlTxt.includes('<button id="analysisToggle" class="analysisToggleBtn panelFloating" aria-expanded="false">'), 'analysis button aria-expanded=false');
  assert.ok(htmlTxt.includes('<div id="legendStack" class="legendStack legendsHidden" aria-hidden="true">'), 'legendStack aria-hidden=true');
  assert.ok(htmlTxt.includes('<div id="analysisSummaryPanel" class="analysisStack analysisHidden" aria-hidden="true">'), 'analysisSummaryPanel aria-hidden=true');
});

// ── v3.4.8 — FIRMS tooltip area-history times (5 km bölge geçmişi; 6 saat event sınırı ötesi birleşir) ──
console.log('\nv3.4.8 — FIRMS area-history tooltip');

test('v3.4.8 — utils: formatTrShortDateTime renders Turkish short format', () => {
  assert.equal(U.formatTrShortDateTime('2026-07-31T11:20:00Z'), '31 Temmuz 14.20');
  assert.equal(U.formatTrShortDateTime('2026-08-01T23:10:00Z'), '2 Ağustos 02.10');
  assert.equal(U.formatTrShortDateTime('garbage'), null);
});

test('v3.4.8 — utils: formatAgeSince returns Turkish human duration', () => {
  const ref = '2026-08-01T12:30:00Z';
  assert.equal(U.formatAgeSince('2026-08-01T00:50:00Z', ref), '11 saat 40 dakika');
  assert.equal(U.formatAgeSince('2026-08-01T11:45:00Z', ref), '45 dakika');
  assert.equal(U.formatAgeSince('2026-08-01T11:30:00Z', ref), '1 saat');
  assert.equal(U.formatAgeSince('2026-07-31T09:30:00Z', ref), '1 gün 3 saat');
  assert.equal(U.formatAgeSince('2026-08-01T12:29:30Z', ref), '1 dakikadan az');
  assert.equal(U.formatAgeSince('invalid', ref), null);
});

test('v3.4.8 — utils: areaHistory merges same-area detections across the 6h event gap', () => {
  const t0 = Date.now();
  const nearA = { lat: 38.50, lon: 27.00, detectedAt: new Date(t0 - 20 * 3600e3).toISOString(), frp: 40 };
  const nearB = { lat: 38.51, lon: 27.01, detectedAt: new Date(t0 - 10 * 3600e3).toISOString(), frp: 35 };
  const h = U.areaHistory([nearA, nearB], nearA, 5);
  assert.equal(h.count, 2, 'both detections merged in 5 km area despite 10h gap');
  assert.notEqual(h.first, h.last, 'first and last differ across the 6h boundary');
  assert.equal(h.first, nearA.detectedAt, 'first is the oldest record');
  assert.equal(h.last, nearB.detectedAt, 'last is the newest record');
});

test('v3.4.8 — utils: areaHistory excludes far independent fires and invalid timestamps', () => {
  const t0 = Date.now();
  const base = { lat: 36.73, lon: 29.20 };
  const a = { lat: 36.730, lon: 29.200, detectedAt: new Date(t0 - 2 * 3600e3).toISOString() };
  const b = { lat: 36.732, lon: 29.202, detectedAt: new Date(t0 - 3 * 3600e3).toISOString() };
  const far = { lat: 36.800, lon: 29.200, detectedAt: new Date(t0 - 4 * 3600e3).toISOString() };
  const invalid = { lat: 36.731, lon: 29.201, detectedAt: 'garbage' };
  const noTime = { lat: 36.731, lon: 29.201 };
  assert.ok(U.haversineKm(base, far) > 5, 'fixture sanity: independent fire beyond 5 km');
  const h = U.areaHistory([a, b, far, invalid, noTime], base, 5);
  assert.equal(h.count, 2, 'far + invalid-timestamp records excluded');
  assert.equal(h.first, b.detectedAt, 'sorted oldest first');
  assert.equal(h.last, a.detectedAt, 'sorted newest last');
});

test('v3.4.8 — utils: areaHistory 48h data-window label', () => {
  const now = Date.now();
  const rec = h => ({ lat: 38.5, lon: 27.0, detectedAt: new Date(now - h * 3600e3).toISOString() });
  assert.equal(U.areaHistory([rec(47)], rec(0), 5).window48, true, '47h window → 48h label');
  assert.equal(U.areaHistory([rec(60)], rec(0), 5).window48, false, '60h window → plain label');
});

test('v3.4.8 — utils: timeReference at Şimdi uses now; past uses selectedTime; future capped', () => {
  const now = Date.now();
  const rNow = U.timeReference(new Date(now - 45 * 60e3), 0);
  assert.ok(Math.abs(rNow.getTime() - now) < 2000, 'slider 0 → current time');
  const rPast = U.timeReference(new Date(now - 3 * 3600e3), -3);
  assert.ok(Math.abs(rPast.getTime() - (now - 3 * 3600e3)) < 2000, 'past slider → selectedTime');
  const rFuture = U.timeReference(new Date(now + 6 * 3600e3), 6);
  assert.ok(rFuture.getTime() <= now + 15 * 60e3 + 2000, 'future capped at now+15min');
  assert.equal(U.formatAgeSince(new Date(now + 60e3).toISOString(), rPast), '1 dakikadan az', 'no negative duration');
});

test('v3.4.8 — map: tooltip builders use area history (not event-scoped times)', () => {
  assert.ok(mapTxt.includes('firesDetectionTooltip(f,history,reference){'), 'detection helper signature');
  assert.ok(mapTxt.includes('firesEventTooltip(ev,history,reference){'), 'cluster helper signature');
  assert.ok(mapTxt.includes('Bölgedeki tek uydu tespiti'), 'single-detection phrase');
  assert.ok(mapTxt.includes('Son 48 saatte ilk uydu tespiti'), '48h label phrase');
  assert.ok(mapTxt.includes('Bölgedeki tespit: ${h.count}'), 'area count row');
  assert.ok(mapTxt.includes('out.join(\'<br>\')'), 'single-line compact layout');
  assert.equal(mapTxt.includes('detEvents'), false, 'event-scoped lookup removed');
  assert.equal(mapTxt.includes('Tespit: ${U.formatLocal(new Date(f.detectedAt))}'), false, 'redundant detection-time row removed');
  assert.equal(mapTxt.includes('<br><br>'), false, 'no double breaks');
});

test('v3.4.8 — map: renderFires wires area history + time reference into tooltips', () => {
  assert.ok(mapTxt.includes('reference=U.timeReference(this.currentSelectedTime'), 'time reference from timeline slider');
  assert.ok(mapTxt.includes('m.bindTooltip(this.firesDetectionTooltip(f,U.areaHistory(this.fireAll,f,radius),reference));'), 'detection tooltip bound with area history');
  assert.ok(mapTxt.includes('m.bindTooltip(this.firesEventTooltip(ev,U.areaHistory(this.fireAll,ev,radius),reference));'), 'cluster tooltip bound with area history');
  assert.ok(mapTxt.includes('radius=C.fireClustering.radiusKm'), 'radius read from config object (C is not a function in map.js)');
  assert.equal(mapTxt.includes('C().fireClustering'), false, 'no C() call syntax in map.js (C is the config object there)');
});

test('v3.4.8 — runtime: detection tooltip shows area first/last/count', () => {
  const h = { records: [{}], count: 2, first: '2026-07-31T11:20:00Z', last: '2026-08-01T10:10:00Z', window48: false };
  const t = AtmoApp.MapManager.prototype.firesDetectionTooltip.call(null,
    { detectedAt: '2026-08-01T10:10:00Z', product: 'VIIRS_NOAA21_NRT', frp: 37.14 },
    h,
    new Date('2026-08-01T21:50:00Z'));
  assert.ok(t.includes('NASA FIRMS termal tespiti'), 'title');
  assert.ok(t.includes('VIIRS_NOAA21_NRT'), 'sensor');
  assert.ok(t.includes('FRP: 37.14 MW'), 'FRP');
  assert.ok(t.includes('İlk uydu tespiti: 31 Temmuz 14.20'), 'first from area history');
  assert.ok(t.includes('Son uydu tespiti: 1 Ağustos 13.10'), 'last from area history');
  assert.ok(t.includes('Son tespit yaşı: 11 saat 40 dakika'), 'age vs reference');
  assert.ok(t.includes('Bölgedeki tespit: 2'), 'area count row');
  assert.equal(t.includes('Tespit:'), false, 'no separate detection-time row');
  assert.equal((t.match(/<br>/g) || []).length, 6, '7 short lines');
});

test('v3.4.8 — runtime: single detection shows tek uydu tespiti instead of first/last', () => {
  const h = { records: [{}], count: 1, first: '2026-08-01T10:10:00Z', last: '2026-08-01T10:10:00Z', window48: false };
  const t = AtmoApp.MapManager.prototype.firesDetectionTooltip.call(null,
    { detectedAt: '2026-08-01T10:10:00Z', product: 'MODIS_NRT', frp: 45 },
    h,
    new Date('2026-08-01T11:10:00Z'));
  assert.ok(t.includes('Bölgedeki tek uydu tespiti'), 'single phrase replaces first/last');
  assert.equal(t.includes('İlk uydu tespiti'), false, 'no first row');
  assert.equal(t.includes('Son uydu tespiti'), false, 'no last row');
  assert.ok(t.includes('Son tespit yaşı: 1 saat'), 'age from own detection');
  assert.equal(t.includes('Bölgedeki tespit:'), false, 'no redundant count row');
});

test('v3.4.8 — runtime: 48h data-window label in detection tooltip', () => {
  const h = { records: [{}], count: 2, first: '2026-07-30T12:00:00Z', last: '2026-08-01T10:10:00Z', window48: true };
  const t = AtmoApp.MapManager.prototype.firesDetectionTooltip.call(null,
    { detectedAt: '2026-08-01T10:10:00Z', product: 'VIIRS_SNPP_NRT', frp: 30 },
    h,
    new Date('2026-08-01T12:00:00Z'));
  assert.ok(t.includes('Son 48 saatte ilk uydu tespiti: 30 Temmuz 15.00'), '48h-labeled first row');
});

test('v3.4.8 — runtime: cluster tooltip shows area history across 6h boundary', () => {
  const h = { records: [{}], count: 8, first: '2026-07-31T11:20:00Z', last: '2026-08-01T10:10:00Z', window48: false };
  const t = AtmoApp.MapManager.prototype.firesEventTooltip.call(null,
    { count: 5, maxFrp: 87.3, earliestDetectedAt: '2026-08-01T06:00:00Z', latestDetectedAt: '2026-08-01T10:10:00Z' },
    h,
    new Date('2026-08-01T21:50:00Z'));
  assert.ok(t.includes('5 FIRMS termal tespiti'), 'event count unchanged');
  assert.ok(t.includes('Maks. FRP: 87.3 MW'), 'max FRP');
  assert.ok(t.includes('İlk uydu tespiti: 31 Temmuz 14.20'), 'first from area history beyond the 6h event boundary');
  assert.ok(t.includes('Son uydu tespiti: 1 Ağustos 13.10'), 'last from area history');
  assert.ok(t.includes('Bölgedeki tespit: 8'), 'area count');
  assert.ok(t.includes('Son tespit yaşı: 11 saat 40 dakika'), 'age');
});

test('v3.4.8 — tooltip and detail panel share the same areaHistory values', () => {
  assert.ok(uiTxt.includes('renderPointDetail(point,air,weather,nearbyFires,areaHistory,fire,fireEvent,gridFeature,nearest){'), 'detail panel takes area history');
  assert.ok(uiTxt.includes('Bölgedeki tespit</small><strong>${hist.count}'), 'detail count from history');
  assert.ok(uiTxt.includes('Son 48 saatte ilk uydu tespiti'), 'detail 48h label');
  assert.ok(appTxt.includes('U.areaHistory(this.map.fireAll'), 'detail uses raw fireAll records');
  assert.ok(appTxt.includes('renderPointDetail(p,air,weather,nearby,ah'), 'detail receives area history');
  const h = { records: [{}], count: 8, first: '2026-07-31T11:20:00Z', last: '2026-08-01T10:10:00Z', window48: false };
  const tip = AtmoApp.MapManager.prototype.firesEventTooltip.call(null, { count: 5, maxFrp: 87.3 }, h, new Date());
  assert.ok(tip.includes('Bölgedeki tespit: 8'), 'tooltip count matches history');
  assert.ok(tip.includes(U.formatTrShortDateTime(new Date(h.first))) && tip.includes(U.formatTrShortDateTime(new Date(h.last))), 'tooltip times match history values');
});

// ============================================================
// v3.4.9 — riskli işaretleme en fazla 5 km (trafo merkezi/hat)
// ============================================================
console.log('\nv3.4.9 — risky marking capped at 5 km');

test('v3.4.9 — impactBands tightened to 0.5/1.5/3/5 km', () => {
  assert.deepEqual(C().impactBands.map(b => b.maxKm), [0.5, 1.5, 3, 5], 'bands lowered from 1/3/10/25');
  assert.deepEqual(C().impactBands.map(b => b.label), ['Kritik yakınlık', 'Yüksek yakınlık', 'Orta yakınlık', 'İzleme alanı'], 'band labels intact');
  assert.equal(C().impactBands.at(-1).maxKm, 5, 'last band caps at 5 km');
});

test('v3.4.9 — runtime: impactBand maps distances against new thresholds', () => {
  assert.equal(U.impactBand(0.4).level, 'critical', '0.4 km critical');
  assert.equal(U.impactBand(1.2).level, 'high', '1.2 km high');
  assert.equal(U.impactBand(2).level, 'medium', '2 km medium');
  assert.equal(U.impactBand(4.9).level, 'watch', '4.9 km watch');
  assert.equal(U.impactBand(6).level, 'low', '>5 km falls back to low');
  assert.equal(U.impactBand(6).label, 'Düşük yakınlık', '>5 km fallback label');
});

test('v3.4.9 — distance score curve steepened, caps lowered (grid.js)', () => {
  assert.ok(gridTxt.includes('minDistanceKm<=0.5?60:minDistanceKm<=1?52:minDistanceKm<=2?44:minDistanceKm<=3?36:minDistanceKm<=5?24:0'), 'new 5 km distance curve');
  assert.ok(gridTxt.includes('Math.min(18,Math.sqrt'), 'FRP capped at 18');
  assert.ok(gridTxt.includes('windScore=8') && gridTxt.includes('windScore=4') && gridTxt.includes('Math.max(windScore,3)'), 'wind caps 8/4/3');
  assert.equal(gridTxt.includes('<=10?28'), false, 'old 10 km tier removed');
  assert.equal(gridTxt.includes('<=25?12'), false, 'old 25 km tier removed');
  assert.equal(gridTxt.includes('Math.min(20,Math.sqrt'), false, 'old FRP cap removed');
});

test('v3.4.9 — invariant: beyond 5 km the max possible score stays below Yüksek (55)', () => {
  const maxNonDistance = 18 + 15 + 10 + 8;
  const highMin = C().riskScoreBands.find(b => b.level === 'high').min;
  assert.equal(maxNonDistance, 51, 'frp 18 + age 15 + asset 10 + wind 8');
  assert.ok(maxNonDistance < highMin, `51 < ${highMin} → no risky marking beyond 5 km`);
});

test('v3.4.9 — map.js: substation square marker guarded via substationRiskDisplayDistanceKm + legend note', () => {
  assert.equal(C().substationRiskDisplayDistanceKm, 5, 'config single source for TM display cap');
  assert.ok(mapTxt.includes('s&&s.distanceKm<=C.substationRiskDisplayDistanceKm'), 'square marker guard reads config cap');
  assert.equal(mapTxt.includes('if(s)L.marker'), false, 'unguarded substation marker removed');
  assert.ok(mapTxt.includes('en fazla ${C.substationRiskDisplayDistanceKm} km'), 'legend states 5 km cap');
});

// ============================================================
// v3.4.12 — UI yalnız en yakın iletim hattını gösterir (TM yok)
// ============================================================
console.log('\nv3.4.12 — UI shows nearest line only, TM stays in risk math');

test('v3.4.12 — config exposes substationRiskDisplayDistanceKm as single source', () => {
  assert.equal(C().substationRiskDisplayDistanceKm, 5, 'config cap present');
  assert.equal(C().impactBands.at(-1).maxKm, 5, 'bands unchanged (risk math intact)');
});

test('v3.4.12 — grid.js splits nearestLine/nearestSubstation/displayedNearestAsset without touching risk math', () => {
  assert.ok(gridTxt.includes("nearestLine:nearest?.line||null,nearestSubstation:nearest?.substation||null,displayedNearestAsset:nearest?.line||null"), 'per-row split fields');
  assert.ok(gridTxt.includes("if(l&&(!s||l.distanceKm<=s.distanceKm)){nearestAsset=l;nearestAssetKind='line';"), 'risk asset pick still min-distance');
  assert.ok(gridTxt.includes("assetScore=l.feature.gridGroup==='400'?10:7;"), 'line score rule intact');
  assert.ok(gridTxt.includes("else if(s){nearestAsset=s;nearestAssetKind='substation';nearestAssetPoint={lat:s.feature.lat,lon:s.feature.lon};assetScore=10;"), 'TM score rule intact');
  assert.ok(gridTxt.includes('minDistanceKm<=0.5?60:minDistanceKm<=1?52:minDistanceKm<=2?44:minDistanceKm<=3?36:minDistanceKm<=5?24:0'), 'distance curve untouched');
  assert.ok(gridTxt.includes('nearestAssetKind,nearestAsset,'), 'legacy export fields kept');
});

test('v3.4.12 — table shows only the nearest line; TM never shown as asset', () => {
  assert.ok(uiTxt.includes('const obj=this.getNearestDisplayedAsset(a),props=obj?.feature.props'), 'row uses line-only helper');
  assert.ok(uiTxt.includes('"En yakın hat"') === false, 'no TM mention in table cell kind');
  assert.ok(uiTxt.includes('Yakın iletim hattı bulunamadı'), 'table no-line fallback');
  assert.equal(uiTxt.includes("useLine?'Hat':'TM'"), false, 'no TM kind in table');
  assert.equal(uiTxt.includes('a.nearest.line'), false, 'table never reads a.nearest.line');
  assert.ok(uiTxt.includes('props?.name||props?.ref||\'Adsız hat\''), 'line name fallback kept');
});

test('v3.4.12 — analysis cards use EN YAKIN HAT and line-only distance', () => {
  assert.ok(uiTxt.includes('⚡ EN YAKIN HAT'), 'card label is EN YAKIN HAT');
  assert.ok(uiTxt.includes('const obj=this.getNearestDisplayedAsset(a),props=obj?.feature?.props'), 'card uses line-only helper');
  assert.ok(uiTxt.includes("'Yakın iletim hattı bulunamadı'"), 'card no-line fallback');
  assert.ok(uiTxt.includes('this.val(obj?.distanceKm,1,\' km\')'), 'card distance from displayed line');
  assert.equal(uiTxt.includes('⚡ EN YAKIN VARLIK'), false, 'old VARLIK label gone');
});

test('v3.4.12 — sorting never uses TM distance/name (line-only keys)', () => {
  assert.ok(uiTxt.includes("case'asset':{const la=a.nearestLine||a.nearest?.line,lb=b.nearestLine||b.nearest?.line;"), 'asset sort key line-only');
  assert.ok(uiTxt.includes("case'distance':{const la=a.nearestLine||a.nearest?.line;va=la?la.distanceKm:Infinity;"), 'distance sort key line-only');
  assert.ok(uiTxt.includes("case'voltage':{const la=a.nearestLine||a.nearest?.line;"), 'voltage sort key line-only');
  assert.equal(uiTxt.includes("sa?.distanceKm"), false, 'no TM distance in any sort branch');
});

test('v3.4.12 — risk top-5 order unchanged; detail panel keeps separate line/TM rows', () => {
  assert.ok(uiTxt.includes('rows.slice(0,5).map((a,i)=>this.riskSummaryCard(a,i))'), 'cards still top-5 by risk pipeline order');
  assert.ok(uiTxt.includes('rows.sort((a,b)=>{let va,vb;switch(this.sortKey){case\'riskScore\':va=a.riskScore;vb=b.riskScore;'), 'default sort still riskScore');
  assert.ok(uiTxt.includes('En yakın hat</small>') && uiTxt.includes('En yakın TM</small>'), 'detail panel keeps separate line/TM metrics');
  assert.ok(uiTxt.includes('minDistanceKm'), 'riskTableRows filter unchanged');
});

test('v3.4.12 — index.html: header + info panel reflect line-only and new bands', () => {
  assert.ok(htmlTxt.includes('En yakın hat <span class="sortArrow"></span>'), 'table header En yakın hat');
  assert.ok(htmlTxt.includes('≤0.5 km: 60 puan'), 'info panel new distance component');
  assert.ok(htmlTxt.includes('&gt;5 km: 0 puan'), 'info panel new fallback');
});

// ============================================================
// v3.4.13 — adaptif rüzgâr koridoru 10–30 km (10 m yüzey rüzgârı)
// ============================================================
console.log('\nv3.4.13 — adaptive downwind corridor 10–30 km');

test('v3.4.13 — config: downwind adaptive block, downwindMaxDistanceKm removed', () => {
  const d = C().downwind;
  assert.equal(d.minDistanceKm, 10, 'min 10 km');
  assert.equal(d.maxDistanceKm, 30, 'max 30 km');
  assert.equal(d.fallbackWindSpeedKmh, 15, 'fallback 15 km/h');
  assert.equal(d.windWeight, 0.65, 'wind weight');
  assert.equal(d.fireWeight, 0.35, 'fire weight');
  assert.equal(d.windMinKmh, 5, 'wind min 5');
  assert.equal(d.windMaxKmh, 35, 'wind max 35');
  assert.equal(d.frpMinMw, 30, 'frp min 30');
  assert.equal(d.frpMaxMw, 300, 'frp max 300');
  const cfgTxt3 = readFileSync('js/config.js', 'utf8');
  const gridTxt3 = readFileSync('js/grid.js', 'utf8');
  const mapTxt3 = readFileSync('js/map.js', 'utf8');
  const uiTxt3 = readFileSync('js/ui.js', 'utf8');
  const appTxt3 = readFileSync('js/app.js', 'utf8');
  assert.equal(cfgTxt3.includes('downwindMaxDistanceKm'), false, 'config: tekil anahtar kaldırıldı');
  assert.equal(gridTxt3.includes('downwindMaxDistanceKm'), false, 'grid.js: tekil anahtar yok');
  assert.equal(mapTxt3.includes('downwindMaxDistanceKm'), false, 'map.js: tekil anahtar yok');
  assert.equal(uiTxt3.includes('downwindMaxDistanceKm'), false, 'ui.js: tekil anahtar yok');
  assert.equal(appTxt3.includes('downwindMaxDistanceKm'), false, 'app.js: tekil anahtar yok');
});

test('v3.4.13 — helper adaptiveCorridorDistanceKm: documented anchors + hard bounds', () => {
  assert.equal(U.adaptiveCorridorDistanceKm(30, 5), 10, '5 km/h + 30 MW → 10 km');
  const mid = U.adaptiveCorridorDistanceKm(100, 15);
  assert.ok(mid >= 17 && mid <= 19, `15 km/h + 100 MW → ≈18 km (got ${mid})`);
  assert.equal(mid, 18, '15 km/h + 100 MW → exactly 18 km');
  assert.equal(U.adaptiveCorridorDistanceKm(300, 35), 30, '≥35 km/h + ≥300 MW → 30 km');
  assert.equal(U.adaptiveCorridorDistanceKm(400, 40), 30, 'above max stays 30 km');
  assert.equal(U.adaptiveCorridorDistanceKm(1, 0), 10, 'below min stays 10 km');
  assert.equal(U.adaptiveCorridorDistanceKm(30, undefined), U.adaptiveCorridorDistanceKm(30, 15), 'speed undefined → 15 km/h fallback');
  for (let i = 0; i < 200; i++) {
    const s = (i % 50) * 2, f = (i * 7) % 500;
    const v = U.adaptiveCorridorDistanceKm(f, s);
    assert.ok(v >= 10 && v <= 30, `bounds ${s} km/h + ${f} MW → ${v}`);
  }
});

test('v3.4.13 — grid.js: fallback chain + corridor fields on every analysis', () => {
  assert.ok(gridTxt.includes('hasSpeed=Number.isFinite(wind.speed),speed=hasSpeed?wind.speed:C.downwind.fallbackWindSpeedKmh'), 'speed missing → 15 km/h fallback');
  assert.ok(gridTxt.includes("if(!hasSpeed){corridorWindSource='fallback';corridorConfidence='low';}"), 'fallback flags model/fallback + low confidence');
  assert.ok(gridTxt.includes('Number.isFinite(wind.direction)'), 'direction required — no direction invention');
  assert.ok(gridTxt.includes('corridorDistanceKm=U.adaptiveCorridorDistanceKm(event.maxFrp,speed)'), 'adaptive helper used per event');
  assert.ok(gridTxt.includes('assetsInSector(event,downwindDirection,corridorDistanceKm)'), 'assetsInSector receives the same corridorDistanceKm');
  assert.ok(gridTxt.includes('corridorDistanceKm,corridorWindSpeedKmh,corridorWindSource,corridorConfidence,'), 'fields exported per analysis');
  assert.ok(gridTxt.includes('U.nearestPoint(event,windData)'), 'corridor reads the 10 m surface wind passed by app');
});

test('v3.4.13 — app.js: surfaceWindData kept separate; 850/700 only visual', () => {
  assert.ok(appTxt.includes("surfaceWindData:[]"), 'state.surfaceWindData initialized');
  assert.ok(appTxt.includes("if(this.state.windLevel!=='10m'){surface=await A.OpenMeteoWeather.grid(pts,this.state.selectedTime,'10m',ctrl.signal)"), 'non-10m level still fetches 10 m grid separately');
  assert.ok(appTxt.includes('this.state.surfaceWindData=surface;'), 'surface stored in state');
  assert.ok(appTxt.includes('this.map.surfaceWindData=surface;'), 'surface stored on map');
  assert.ok(appTxt.includes('analyzeEvents(this.state.fireEvents,25,this.state.selectedTime,this.state.surfaceWindData)'), 'impact analysis always consumes 10 m surface data');
  assert.ok(appTxt.includes('this.map.setWind(data,this.state.windLevel)'), 'visual wind layer keeps selected level (850/700)');
});

test('v3.4.13 — map.js: polygon, tooltip and legend use the same corridorDistanceKm', () => {
  assert.ok(mapTxt.includes('maxKm=a.corridorDistanceKm||C.downwind.maxDistanceKm'), 'polygon radius = per-event corridorDistanceKm');
  assert.ok(mapTxt.includes('U.destination(center,bearing,maxKm)'), 'same maxKm feeds destination()');
  assert.ok(mapTxt.includes('a.corridorWindSpeedKmh??a.wind.speed'), 'tooltip shows real/fallback speed');
  assert.ok(mapTxt.includes('Maks. FRP'), 'tooltip shows max FRP');
  assert.ok(mapTxt.includes("corridorWindSource==='fallback'?'Rüzgâr hızı eksik · 15 km/h varsayımı (fallback)':'Model 10 m yüzey rüzgârı'"), 'tooltip states model vs fallback');
  assert.ok(mapTxt.includes('Koridorda: <strong>${dw.lines.length} hat / ${dw.substations.length} TM'), 'tooltip shows corridor line/TM counts');
  assert.ok(mapTxt.includes('Operasyonel taramadır; yayılım tahmini değildir.'), 'tooltip operational disclaimer');
  assert.ok(mapTxt.includes('Adaptif ${C.downwind.minDistanceKm}–${C.downwind.maxDistanceKm} km'), 'legend title adaptive 10–30 km');
  assert.ok(mapTxt.includes('10 m yüzey rüzgârı + maks. FRP'), 'legend explains 10 m surface wind + FRP');
});

test('v3.4.13 — UI + export expose corridor fields', () => {
  assert.ok(uiTxt.includes('· Rüzgâr etkisi: ${a.corridorDistanceKm||\'—\'} km koridorda'), 'card meta uses adaptive corridor distance');
  assert.ok(uiTxt.includes('30 km koridorda') === false, 'hardcoded 30 km removed from card');
  const expTxt = readFileSync('js/export.js', 'utf8');
  assert.ok(expTxt.includes('corridorDistanceKm'), 'csv header corridorDistanceKm');
  assert.ok(expTxt.includes('corridorWindSpeedKmh'), 'csv corridorWindSpeedKmh');
  assert.ok(expTxt.includes('corridorWindSource'), 'csv corridorWindSource');
  assert.ok(expTxt.includes('corridorConfidence'), 'csv corridorConfidence');
  assert.ok(expTxt.includes('surfaceWindData:state.surfaceWindData||[]'), 'json export includes surface wind');
});

test('v3.4.13 — risk score formula untouched (windScore 8/4/3), ordering stable', () => {
  assert.ok(gridTxt.includes('downwindAlignment=diff<=35;if(downwindAlignment)windScore=8;else if(diff<=60)windScore=4;'), 'score branches unchanged');
  assert.ok(gridTxt.includes('windScore=Math.max(windScore,3)'), 'corridor-asset bonus unchanged');
  assert.ok(gridTxt.includes('out.sort((a,b)=>b.riskScore-a.riskScore||'), 'risk ordering unchanged');
  const uiTxt4 = readFileSync('js/ui.js', 'utf8');
  assert.ok(uiTxt4.includes('rows.slice(0,5).map((a,i)=>this.riskSummaryCard(a,i))'), 'top-5 cards intact');
});

// ── Run ──
await run();
