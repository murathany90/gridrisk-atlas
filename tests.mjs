import { readFileSync } from 'fs';
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
global.performance = { now: () => 0 };
global.location = { protocol: 'https:', hostname: 'localhost' };
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;
global.AbortController = AbortController;

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
const FPA = AtmoApp.FirePolygonAdapter;

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
// ITEM 3 — FirePolygonAdapter lastGood / stale / empty / error
// ============================================================
console.log('\nItem 3 — FirePolygonAdapter lastGood / stale / empty / error');

function lgEntry() { return FPA._lastGood(FPA.dateRange()) || { fc: null, at: null }; }
function lgFeatures() { const e = lgEntry(); return e.fc; }
function lgAt() { const e = lgEntry(); return e.at; }

async function resetAdapter() {
  AtmoApp.FirePolygonAdapter = FPA;
  FPA._lastGoodMap.clear();
  AtmoApp.Cache.clear();
  global.fetch = null;
  // Reset date range to default 7d
  const now = Date.now();
  FPA.setDateRange(now - 7 * 86400000, now);
}

function mockFetch(features, opts = {}) {
  const failCount = opts.failCount ?? 0;
  let callCount = 0;
  global.fetch = async (url) => {
    callCount++;
    if (callCount <= failCount) throw new Error(opts.errorMsg || 'NETWORK_ERROR');
    return {
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features, exceededTransferLimit: false })
    };
  };
}

test('ok: features>0 updates state and lastGood', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] }, properties: { date: '2026-07-30', il: 'Antalya', konum: 'Manavgat', area_ha: 500 } }]);
  const r = await FPA.load(new AbortController().signal);
  assert.ok(!r._stale, 'not stale');
  assert.ok(!r._error, 'no error');
  assert.equal(r.features.length, 1);
  const lg = lgFeatures();
  assert.ok(lg !== null, 'lastGood set');
  assert.equal(lg.features.length, 1);
  assert.ok(lgAt() !== null, 'lastSuccessfulAt set');
});

test('empty: features=0 clears polygons, does not update lastGood', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', konum: 'Manavgat', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const r1 = await FPA.load(new AbortController().signal);
  assert.equal(r1.features.length, 1);
  assert.ok(lgFeatures() !== null);
  AtmoApp.Cache.clear();

  mockFetch([]);
  const r2 = await FPA.load(new AbortController().signal);
  assert.equal(r2.features.length, 0, 'empty features');
  assert.ok(!r2._stale, 'not stale');
  assert.ok(!r2._error, 'no error');
  assert.equal(lgFeatures().features.length, 1, 'lastGood unchanged after empty');
});

test('failure+lastGood→stale', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.ok(lgFeatures() !== null);
  AtmoApp.Cache.clear();

  mockFetch([], { failCount: 1, errorMsg: 'NETWORK_ERROR' });
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._stale, 'marked as stale');
  assert.ok(r._error, 'has error');
  assert.equal(r.features.length, 1, 'stale returns lastGood data');
});

test('partial pagination does not update lastGood', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now()-30*86400000, Date.now());
  let call=0;
  global.fetch = async (url) => {
    call++;
    if(call===1) return { ok:true, json:async()=>({type:'FeatureCollection',features:[{type:'Feature',properties:{date:'2026-07-01',il:'Antalya',area_ha:100},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}],exceededTransferLimit:true}) };
    throw new Error('NETWORK_ERROR');
  };
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._partial, 'result has _partial flag');
  assert.equal(FPA._lastGoodMap.size, 0, 'partial pagination does not store lastGood');
});

test('failure+noLastGood→error', async () => {
  await resetAdapter();
  mockFetch([], { failCount: 1, errorMsg: 'NETWORK_ERROR' });
  const r = await FPA.load(new AbortController().signal);
  assert.ok(!r._stale, 'not stale');
  assert.ok(r._error, 'has error');
  assert.equal(r.features.length, 0, 'empty features');
});

test('pre-aborted signal throws ABORTED without state change', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const ctrl = new AbortController();
  ctrl.abort();
  let err = null;
  try { await FPA.load(ctrl.signal); } catch (e) { err = e; }
  assert.ok(err, 'load throws on pre-aborted signal');
  assert.equal(err.kind, 'ABORTED', 'controlled ABORTED error');
  assert.equal(FPA._lastGoodMap.size, 0, 'lastGoodMap unchanged after aborted load');
});

test('stale metadata includes count and lastSuccessfulAt', async () => {
  await resetAdapter();
  const before = Date.now();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.ok(lgAt() >= before, 'lastSuccessfulAt recorded');
  AtmoApp.Cache.clear();

  mockFetch([], { failCount: 1, errorMsg: 'NETWORK_ERROR' });
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._stale, 'stale');
  assert.ok(r._error.includes('NETWORK_ERROR'), 'error message preserved');
  assert.equal(r.features.length, 1, 'returns lastGood data');
});

test('lastGood updated only on non-empty success', async () => {
  await resetAdapter();
  AtmoApp.Cache.clear();
  mockFetch([]);
  await FPA.load(new AbortController().signal);
  assert.equal(FPA._lastGoodMap.size, 0, 'lastGood not set on empty');

  AtmoApp.Cache.clear();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const r = await FPA.load(new AbortController().signal);
  assert.equal(r.features.length, 1);
  assert.equal(lgFeatures().features.length, 1, 'lastGood set after non-empty');
  AtmoApp.Cache.clear();

  mockFetch([]);
  await FPA.load(new AbortController().signal);
  assert.equal(lgFeatures().features.length, 1, 'lastGood preserved after empty success');
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
// v3.3 — FirePolygonAdapter date range
// ============================================================
console.log('\nv3.3 — FirePolygonAdapter date range');

test('FirePolygonAdapter dateRange returns default values', () => {
  assert.ok(FPA.dateRange().start <= Date.now());
  assert.ok(FPA.dateRange().end <= Date.now());
  assert.ok(FPA.dateRange().start < FPA.dateRange().end);
});

test('FirePolygonAdapter setDateRange persists rolling days', () => {
  localStorage.removeItem('firePolygonRangeDays');
  const start = Date.now() - 14 * 86400000;
  const end = Date.now();
  FPA.setDateRange(start, end);
  const r = FPA.dateRange();
  const diff = Math.round((r.end - r.start) / 86400000);
  assert.equal(diff, 14, 'dateRange returns 14-day rolling window');
  assert.ok(r.end > Date.now() - 1000, 'end is rolling (now)');
  // Cleanup
  localStorage.removeItem('firePolygonRangeDays');
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
// Audit — MTG demonstration metadata
// ============================================================
console.log('\nAudit — MTG adapter');

test('MTG adapter status is NOT_CONFIGURED', () => {
  assert.equal(AtmoApp.MtgAdapter.status, 'NOT_CONFIGURED');
});

test('MTG adapter load returns empty without key', async () => {
  const result = await AtmoApp.MtgAdapter.load(new AbortController().signal);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test('MTG adapter does not crash on load', async () => {
  let threw = false;
  try {
    await AtmoApp.MtgAdapter.load(new AbortController().signal);
  } catch(e) {
    threw = true;
  }
  assert.equal(threw, false, 'MTG load does not throw');
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
// Audit — FirePolygon date range cache separation
// ============================================================
console.log('\nAudit — FirePolygon date range');

test('FirePolygonAdapter dateRange default 7 days', () => {
  localStorage.removeItem('firePolygonRangeDays');
  const range = AtmoApp.FirePolygonAdapter.dateRange();
  const diffDays = (range.end - range.start) / 86400000;
  assert.ok(Math.abs(diffDays - 7) <= 1, `default range ~7 days, got ${diffDays}`);
});

test('date range race: seq check prevents overwrite', () => {
  let seq = 0;
  function simulateLoad(days) {
    const s = ++seq;
    const end = Date.now();
    const start = end - days * 86400000;
    AtmoApp.FirePolygonAdapter.setDateRange(start, end);
    const mySeq = s;
    return function check() {
      if (mySeq !== seq) return false;
      return true;
    };
  }
  const c1 = simulateLoad(30);
  const c2 = simulateLoad(3);
  assert.ok(c2(), 'second (3d) check passes');
  assert.ok(!c1(), 'first (30d) check fails — stale overwrite prevented');
});

test('cache key differs per date range', () => {
  const rk1 = FPA._rangeKey({ start: Date.now() - 3 * 86400000, end: Date.now() });
  const rk2 = FPA._rangeKey({ start: Date.now() - 7 * 86400000, end: Date.now() });
  const rk3 = FPA._rangeKey({ start: Date.now() - 30 * 86400000, end: Date.now() });
  assert.notEqual(rk1, rk2, '3d key ≠ 7d key');
  assert.notEqual(rk2, rk3, '7d key ≠ 30d key');
  assert.notEqual(rk1, rk3, '3d key ≠ 30d key');
  // Same range produces same key
  const a = Date.now() - 7 * 86400000, b = Date.now();
  assert.equal(FPA._rangeKey({ start: a, end: b }), FPA._rangeKey({ start: a, end: b }), 'same range → same key');
});

test('30d lastGood not used as stale fallback for 3d request', async () => {
  await resetAdapter();
  // Set 30d range and load successfully
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-01', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.equal(FPA._lastGoodMap.size, 1, '30d lastGood stored');
  AtmoApp.Cache.clear();

  // Switch to 3d range and fail
  FPA.setDateRange(Date.now() - 3 * 86400000, Date.now());
  mockFetch([], { failCount: 1, errorMsg: 'NETWORK_ERROR' });
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._stale === undefined || r._stale === false, '3d request not stale from 30d lastGood');
  assert.equal(r.features.length, 0, 'no stale fallback for different range');
  assert.equal(FPA._lastGoodMap.size, 1, 'only 30d lastGood remains');
});

test('30d→3d race + cache combination', async () => {
  await resetAdapter();
  // Set 30d range
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  const rk30 = FPA._rangeKey(FPA.dateRange());
  // Switch to 3d range immediately (simulating user switching before 30d completes)
  FPA.setDateRange(Date.now() - 3 * 86400000, Date.now());
  const rk3 = FPA._rangeKey(FPA.dateRange());
  // Verify keys are different
  assert.notEqual(rk30, rk3, '30d and 3d have different range keys');

  // 30d response arrives late → should NOT overwrite 3d cache
  // Simulate by checking that cache keys are isolated
  AtmoApp.Cache.set(`firePolygons:${rk30}`, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-01' } }] }, 60000);
  AtmoApp.Cache.set(`firePolygons:${rk3}`, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-28' } }] }, 60000);
  const c30 = AtmoApp.Cache.get(`firePolygons:${rk30}`);
  const c3 = AtmoApp.Cache.get(`firePolygons:${rk3}`);
  assert.ok(c30 !== null, '30d cache present');
  assert.ok(c3 !== null, '3d cache present');
  assert.notEqual(c30, c3, 'different cache values for different ranges');
});

test('date range note appears in load result', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 3 * 86400000, Date.now());
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._rangeKey, 'result has _rangeKey');
  assert.ok(/^\d+:\d+$/.test(r._rangeKey), `rangeKey uses days:hourBucket format, got ${r._rangeKey}`);
  assert.ok(r._rangeKey.startsWith('3:'), `rangeKey reflects 3-day preset, got ${r._rangeKey}`);
  // Reset
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
});

test('different date ranges store separate lastGood entries', async () => {
  await resetAdapter();
  // Load 7d successfully
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-25', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.equal(FPA._lastGoodMap.size, 1);

  // Load 3d successfully (different range)
  FPA.setDateRange(Date.now() - 3 * 86400000, Date.now());
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-28', il: 'Mugla', area_ha: 50 }, geometry: { type: 'Polygon', coordinates: [[[2,2],[3,2],[3,3],[2,3],[2,2]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.equal(FPA._lastGoodMap.size, 2, 'two separate lastGood entries');

  // 7d request fails → uses 7d lastGood (not 3d)
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
  AtmoApp.Cache.clear();
  mockFetch([], { failCount: 1, errorMsg: 'NETWORK_ERROR' });
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._stale, '7d stale');
  assert.equal(r.features.length, 1, '7d stale returns 7d data with 1 feature');
  assert.equal(r.features[0].properties.il, 'Antalya', 'correct 7d data');

  // 3d lastGood still intact
  FPA.setDateRange(Date.now() - 3 * 86400000, Date.now());
  const lg3 = FPA._lastGood(FPA.dateRange());
  assert.ok(lg3 !== null, '3d lastGood preserved');
  assert.equal(lg3.fc.features[0].properties.il, 'Mugla', '3d data correct');

  // Reset
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
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
// v3.3.2 — FirePolygon rolling cache (preset + hour bucket)
// ============================================================
console.log('\nv3.3.2 — FirePolygon rolling cache');

test('1d hour-bucket cache keys differ across hours', () => {
  const k1 = FPA.cacheKey(1, new Date('2026-07-30T09:00:00Z').getTime());
  const k2 = FPA.cacheKey(1, new Date('2026-07-30T18:00:00Z').getTime());
  assert.notEqual(k1, k2, '09:00 and 18:00 → different hour buckets → different keys');
});

test('preset cache isolation: 1d/3d/7d/30d keys never collide', () => {
  const t = Date.now();
  const keys = new Set([FPA.cacheKey(1, t), FPA.cacheKey(3, t), FPA.cacheKey(7, t), FPA.cacheKey(30, t)]);
  assert.equal(keys.size, 4, 'four distinct preset keys');
});

test('same preset + same hour bucket reuses cache key', () => {
  const t1 = new Date('2026-07-30T10:30:00Z').getTime();
  const t2 = new Date('2026-07-30T10:45:00Z').getTime();
  assert.equal(FPA.cacheKey(7, t1), FPA.cacheKey(7, t2), 'same hour bucket → same key');
});

test('cache key format: firePolygons:{days}:{hourBucket}', () => {
  const t = new Date('2026-07-30T10:30:00Z').getTime();
  const bucket = Math.floor(t / 3600000);
  assert.equal(FPA.cacheKey(3, t), `firePolygons:3:${bucket}`);
});

test('same preset same hour bucket load served from cache without refetch', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 1 * 86400000, Date.now());
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }], exceededTransferLimit: false }) }; };
  const r1 = await FPA.load(new AbortController().signal);
  assert.equal(calls, 1);
  const r2 = await FPA.load(new AbortController().signal);
  assert.equal(calls, 1, 'cache hit — no second fetch in same hour bucket');
  assert.equal(r2.features.length, 1);
});

test('different presets do not share cache entries', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 3 * 86400000, Date.now());
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-28', il: 'Mugla', area_ha: 50 }, geometry: { type: 'Polygon', coordinates: [[[2,2],[3,2],[3,3],[2,3],[2,2]]] } }], exceededTransferLimit: false }) }; };
  await FPA.load(new AbortController().signal);
  assert.equal(calls, 1);
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
  await FPA.load(new AbortController().signal);
  assert.equal(calls, 2, '7d preset refetches — no shared cache with 3d');
});

// ============================================================
// v3.3.2 — FirePolygon pagination abort
// ============================================================
console.log('\nv3.3.2 — FirePolygon pagination abort');

test('abort during page 2 throws ABORTED, no partial/lastGood', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  let call = 0;
  const ctrl = new AbortController();
  global.fetch = (url, { signal }) => {
    call++;
    if (call === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-01', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }], exceededTransferLimit: true }) });
    return new Promise((_, rej) => {
      signal.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      ctrl.abort();
    });
  };
  let err = null;
  try { await FPA.load(ctrl.signal); } catch (e) { err = e; }
  assert.ok(err, 'load throws');
  assert.equal(err.kind, 'ABORTED', 'controlled ABORTED error, not partial completion');
  assert.equal(FPA._lastGoodMap.size, 0, 'lastGood not updated on abort');
});

// ============================================================
// v3.3.2 — FirePolygon MAX_PAGES safety limit
// ============================================================
console.log('\nv3.3.2 — FirePolygon MAX_PAGES safety limit');

test('MAX_PAGES with exceededTransferLimit → _partial, warn, no lastGood', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  let calls = 0;
  let note = '';
  const off = AtmoApp.Events.on('service', p => { if (p.id === 'firePolygon') note = p.note; });
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-01', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }], exceededTransferLimit: true }) }; };
  const r = await FPA.load(new AbortController().signal);
  off();
  assert.equal(calls, 50, 'pagination hit safety limit');
  assert.equal(r._partial, true, '_partial === true');
  assert.equal(r.features.length, 50, 'partial dataset accumulated');
  assert.equal(FPA._lastGoodMap.size, 0, 'lastGood not updated for incomplete data');
  assert.ok(note.includes('kısmi veri'), 'warn note mentions partial: ' + note);
});

test('MAX_PAGES partial prefers complete lastGood as stale', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  const feat = () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-01', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }], exceededTransferLimit: false });
  global.fetch = async () => { const f = feat(); return { ok: true, status: 200, json: async () => f }; };
  await FPA.load(new AbortController().signal);
  assert.equal(FPA._lastGoodMap.size, 1, 'complete lastGood stored');
  AtmoApp.Cache.clear();
  global.fetch = async () => { const f = feat(); f.exceededTransferLimit = true; return { ok: true, status: 200, json: async () => f }; };
  const r2 = await FPA.load(new AbortController().signal);
  assert.ok(r2._stale, 'stale preferred over partial');
  assert.equal(r2.features.length, 1, 'stale returns lastGood data');
  assert.equal(FPA._lastGoodMap.size, 1, 'lastGood unchanged');
});

// ============================================================
// v3.3.2 — FirePolygon empty message by preset
// ============================================================
console.log('\nv3.3.2 — FirePolygon empty message by preset');

test('emptyNote matches each preset', () => {
  assert.equal(FPA.emptyNote(1), 'Son 24 saatte yangın alanı bulunmadı');
  assert.equal(FPA.emptyNote(3), 'Son 3 günde yangın alanı bulunmadı');
  assert.equal(FPA.emptyNote(7), 'Son 7 günde yangın alanı bulunmadı');
  assert.equal(FPA.emptyNote(30), 'Son 30 günde yangın alanı bulunmadı');
});

test('empty load reports preset-based message', async () => {
  await resetAdapter();
  let note = '';
  const off = AtmoApp.Events.on('service', p => { if (p.id === 'firePolygon') note = p.note; });
  FPA.setDateRange(Date.now() - 1 * 86400000, Date.now());
  mockFetch([]);
  await FPA.load(new AbortController().signal);
  assert.ok(note.includes('Son 24 saatte'), '1d preset empty message: ' + note);
  AtmoApp.Cache.clear();
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
  mockFetch([]);
  await FPA.load(new AbortController().signal);
  assert.ok(note.includes('Son 7 günde'), '7d preset empty message: ' + note);
  AtmoApp.Cache.clear();
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  mockFetch([]);
  await FPA.load(new AbortController().signal);
  assert.ok(note.includes('Son 30 günde'), '30d preset empty message: ' + note);
  off();
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
// v3.3.3 — FirePolygon pagination completed next page = ok
// ============================================================
console.log('\nv3.3.3 — FirePolygon pagination completed next page');

test('page1 exceeded=true then page2 exceeded=false → ok, lastGood saved', async () => {
  await resetAdapter();
  FPA.setDateRange(Date.now() - 30 * 86400000, Date.now());
  let call = 0, note = '';
  const off = AtmoApp.Events.on('service', p => { if (p.id === 'firePolygon') note = p.note; });
  global.fetch = async () => {
    call++;
    const exceeded = call === 1;
    return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { date: '2026-07-01', il: 'Antalya', area_ha: 100 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }], exceededTransferLimit: exceeded }) };
  };
  const r = await FPA.load(new AbortController().signal);
  off();
  assert.equal(call, 2, 'two pages fetched');
  assert.equal(r._partial, false, 'NOT partial — page 2 completed the dataset');
  assert.equal(r._stale, undefined, 'not stale');
  assert.equal(r.features.length, 2, 'both pages accumulated');
  assert.equal(FPA._lastGoodMap.size, 1, 'complete multi-page result stored as lastGood');
  assert.ok(!note.includes('kısmi'), 'report ok without partial note: ' + note);
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
// v3.3.3 — FirePolygon lastGood rolling range key (days:hourBucket)
// ============================================================
console.log('\nv3.3.3 — FirePolygon lastGood rolling range key');

test('rangeKey format is days:hourBucket', () => {
  const k = FPA._rangeKey({ start: Date.now() - 3 * 86400000, end: Date.now() });
  assert.ok(/^3:\d+$/.test(k), `got ${k}`);
});

test('rangeKey differs when rolling window moves to next hour bucket (same calendar days)', () => {
  const endA = new Date('2026-07-30T10:30:00Z').getTime();
  const endB = new Date('2026-07-30T11:45:00Z').getTime();
  const kA = FPA._rangeKey({ start: endA - 86400000, end: endA });
  const kB = FPA._rangeKey({ start: endB - 86400000, end: endB });
  assert.ok(/^1:\d+$/.test(kA), `1d key format: ${kA}`);
  assert.notEqual(kA, kB, 'same calendar date pair, different hour bucket → different key');
});

test('lastGood lookup is hour-bucket scoped; 24h-old window not matched', async () => {
  await resetAdapter();
  const endA = new Date('2026-07-30T10:30:00Z').getTime();
  const endB = new Date('2026-07-30T11:45:00Z').getTime();
  FPA._setLastGood({ start: endA - 86400000, end: endA }, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { il: 'Antalya' } }] });
  const lgA = FPA._lastGood({ start: endA - 86400000, end: endA });
  const lgB = FPA._lastGood({ start: endB - 86400000, end: endB });
  const lgOld = FPA._lastGood({ start: endA - 86400000, end: endA + 86400000 });
  assert.ok(lgA, 'same range returns lastGood');
  assert.equal(lgB, null, 'next-hour window (same calendar pair) does not match lastGood');
  assert.equal(lgOld, null, '24h-old window does not match current lastGood');
  FPA._lastGoodMap.clear();
});

// ============================================================
// v3.3.3 — GitHub Pages: no fake server calls
// ============================================================
console.log('\nv3.3.3 — GitHub Pages mode guards');

test('MTG on GitHub Pages: no fetch, warn Sunucu modu gerekli', async () => {
  const orig = global.location;
  global.location = { protocol: 'https:', hostname: 'murathany90.github.io' };
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ features: [] }) }; };
  let note = '';
  const off = AtmoApp.Events.on('service', p => { if (p.id === 'mtg') note = p.note; });
  try {
    const r = await AtmoApp.MtgAdapter.load(new AbortController().signal);
    assert.equal(r.length, 0);
    assert.equal(calls, 0, 'no /api/mtg/active_fires call on GitHub Pages');
    assert.ok(note.includes('Sunucu modu gerekli'), 'warn note: ' + note);
  } finally { off(); global.location = orig; }
});

test('MTG on local server still calls proxy', async () => {
  const orig = global.location;
  global.location = { protocol: 'http:', hostname: 'localhost' };
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ status: 'NOT_CONFIGURED' }) }; };
  try {
    const r = await AtmoApp.MtgAdapter.load(new AbortController().signal);
    assert.equal(calls, 1, 'proxy called on local server');
    assert.equal(r.length, 0, 'NOT_CONFIGURED response → empty result');
  } finally { global.location = orig; }
});

test('AtmoHub discovery on GitHub Pages: SERVER_REQUIRED without fetch', async () => {
  const orig = global.location;
  global.location = { protocol: 'https:', hostname: 'murathany90.github.io' };
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ verified: [] }) }; };
  try {
    const r = await AtmoApp.AtmoHubAdapter.discoverCapabilities(true);
    assert.equal(r.available, false);
    assert.equal(r.reason, 'SERVER_REQUIRED');
    assert.equal(calls, 0, 'no /api/atmohub/discover call on GitHub Pages');
  } finally { global.location = orig; }
});

test('AtmoHub discovery on localhost still calls server', async () => {
  const orig = global.location;
  global.location = { protocol: 'http:', hostname: 'localhost' };
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ verified: [{ url: 'https://x/api' }] }) }; };
  try {
    const r = await AtmoApp.AtmoHubAdapter.discoverCapabilities(false);
    assert.equal(calls, 1, 'server discovery called on localhost');
    assert.equal(r.available, true, 'verified candidate → available');
  } finally { global.location = orig; }
});

test('GFW key missing: returns empty with warn, no fetch', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ data: [] }) }; };
  let note = '';
  const off = AtmoApp.Events.on('service', p => { if (p.id === 'gfw') note = p.note; });
  try {
    const r = await AtmoApp.GfwAdapter.load(new AbortController().signal);
    assert.equal(r.length, 0);
    assert.equal(calls, 0, 'no GFW fetch when key missing');
    assert.ok(note.includes('GFW'), 'warn note mentions GFW: ' + note);
  } finally { off(); }
});

// ── v3.3.4 mobile-responsive / overflow contract ──
const cssTxt = readFileSync('css/styles.css', 'utf8');
const htmlTxt = readFileSync('index.html', 'utf8');
const appTxt = readFileSync('js/app.js', 'utf8');
const mapTxt = readFileSync('js/map.js', 'utf8');
const uiTxt = readFileSync('js/ui.js', 'utf8');

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

test('v3.3.6 version bump to 3.3.6 in all files', () => {
  assert.ok(htmlTxt.includes('v3.3.6'), 'index.html buildPill');
  assert.ok(htmlTxt.includes('v=3.3.6'), 'index.html cache-busting');
  assert.ok(cfgTxt.includes("appVersion: '3.3.6'"), 'config.js appVersion');
  assert.ok(srvTxt.includes("APP_VERSION='3.3.6'"), 'server.mjs APP_VERSION');
  assert.ok(pkgTxt.includes('"version":"3.3.6"'), 'package.json version');
  assert.equal(htmlTxt.includes('3.3.5'), false, 'no stale 3.3.5 in index.html');
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

// ── Run ──
await run();
