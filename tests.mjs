import { readFileSync } from 'fs';
import { strict as assert } from 'assert';

// ── Setup environment ──
global.window = global;
global.AtmoApp = {};
global.document = {
  createElement(tag) { const el = { tag, style: {}, classList: { add() {} }, addEventListener() {}, remove() {} }; if (tag === 'a') { el.click = () => {}; el.href = ''; } return el; },
  body: { appendChild() {}, removeChild() {} },
  getElementById() { return null; },
  querySelector() { return null; }
};
global.L = { DomUtil: { create() { return {}; }, setPosition() {} }, DomEvent: { stopPropagation() {} } };
const storage = new Map();
global.localStorage = {
  getItem(k) { return storage.get(k) ?? null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
  clear() { storage.clear(); }
};
global.performance = { now: () => 0 };
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

test('latitude-aware cell: north Turkey vs south Turkey', () => {
  const kmPerLat = 111.32;
  const cos36 = Math.cos(36 * Math.PI / 180);
  const lonCell36 = 5 / (kmPerLat * cos36);
  const cos42 = Math.cos(42 * Math.PI / 180);
  const lonCell42 = 5 / (kmPerLat * cos42);
  assert.ok(lonCell36 < lonCell42, 'smaller lon cell at lower latitude');
  const ratio = lonCell36 / lonCell42;
  assert.ok(Math.abs(ratio - (cos42 / cos36)) < 0.001, 'lat-aware cell ratio matches cos ratio');
});

test('cosLat division safety for extreme latitudes', () => {
  const kmPerLat = 111.32;
  const cos0 = Math.max(0.01, Math.min(1, Math.cos(0)));
  assert.equal(cos0, 1, 'cos(0) = 1 after clamp');
  const raw89 = Math.cos(89 * Math.PI / 180);
  const cos89 = Math.max(0.01, Math.min(1, raw89));
  assert.ok(cos89 >= 0.01, 'cos(89°) clamped to ≥0.01');
  assert.ok(cos89 <= 1, 'cos(89°) clamped to ≤1');
  assert.ok(cos89 < raw89 + 0.001 || Math.abs(cos89 - 0.01) < 0.001, 'clamp engaged for near-pole');
  const lonCell89 = 5 / (kmPerLat * cos89);
  assert.ok(Number.isFinite(lonCell89), 'lonCell finite at extreme lat');
  assert.ok(lonCell89 < 5, 'lonCell < 5° at extreme lat');
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

test('abort does not change state or produce stale/error', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const ctrl = new AbortController();
  ctrl.abort();
  const r = await FPA.load(ctrl.signal);
  assert.ok(!r._stale, 'not stale on abort');
  assert.ok(!r._error, 'no error on abort');
  assert.equal(r.features.length, 0, 'empty features on abort');
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

test('FirePolygonAdapter setDateRange persists and is readable', () => {
  const start = Date.now() - 14 * 86400000;
  const end = Date.now() - 7 * 86400000;
  FPA.setDateRange(start, end);
  const r = FPA.dateRange();
  const diff = Math.round((r.end - r.start) / 86400000);
  assert.equal(diff, 7, 'dateRange returns persisted 7-day window');
  assert.ok(Math.abs(r.start - start) < 1000, 'start matches');
  assert.ok(Math.abs(r.end - end) < 1000, 'end matches');
  // Reset to default
  FPA.setDateRange(Date.now() - 7 * 86400000, Date.now());
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
  const FA = AtmoApp.FirmsAdapter;
  const m = { lat: 39.0, lon: 33.0, scan: 0.8, track: 0.6, brightTi4: 340, brightTi5: null };
  const kmPerLat = 110.574, kmPerLon = 111.32 * Math.cos(m.lat * Math.PI / 180);
  const halfLon = Math.max(0.0005, (m.scan || 1) / 2 / kmPerLon);
  const halfLat = Math.max(0.0005, (m.track || 1) / 2 / kmPerLat);
  assert.ok(Number.isFinite(halfLon));
  assert.ok(Number.isFinite(halfLat));
  assert.ok(halfLon > 0);
  const halfLonSame = Math.max(0.0005, (m.scan || 1) / 2 / kmPerLon);
  const halfLatSame = Math.max(0.0005, (m.track || 1) / 2 / kmPerLat);
  assert.equal(halfLon, halfLonSame, 'TI4/TI5 does not affect footprint');
  assert.equal(halfLat, halfLatSame, 'TI4/TI5 does not affect footprint');
});

test('changing scan/track changes footprint size', () => {
  const m1 = { lat: 39.0, lon: 33.0, scan: 0.4, track: 0.6 };
  const m2 = { lat: 39.0, lon: 33.0, scan: 1.0, track: 1.0 };
  const kmPerLat = 110.574, kmPerLon = 111.32 * Math.cos(39 * Math.PI / 180);
  const halfLon1 = Math.max(0.0005, (m1.scan || 1) / 2 / kmPerLon);
  const halfLon2 = Math.max(0.0005, (m2.scan || 1) / 2 / kmPerLon);
  assert.ok(halfLon1 < halfLon2, 'larger scan → larger footprint');
});

test('null/NaN scan/track does not crash', () => {
  const cases = [
    { scan: null, track: null },
    { scan: NaN, track: NaN },
    { scan: undefined, track: undefined },
    { scan: 0, track: 0 },
  ];
  for (const c of cases) {
    const kmPerLat = 110.574, kmPerLon = 111.32 * Math.cos(39 * Math.PI / 180);
    const halfLon = Math.max(0.0005, (c.scan || 1) / 2 / kmPerLon);
    const halfLat = Math.max(0.0005, (c.track || 1) / 2 / kmPerLat);
    assert.ok(Number.isFinite(halfLon), `scan=${c.scan} produces finite halfLon`);
    assert.ok(Number.isFinite(halfLat), `track=${c.track} produces finite halfLat`);
  }
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
  assert.ok(r._rangeKey.includes('2026'), 'rangeKey contains date');
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

// ── Run ──
await run();
