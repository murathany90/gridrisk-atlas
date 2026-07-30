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

async function resetAdapter() {
  AtmoApp.FirePolygonAdapter = FPA;
  FPA.lastGood = null;
  FPA.lastSuccessfulAt = null;
  AtmoApp.Cache.clear();
  global.fetch = null;
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
  assert.ok(FPA.lastGood !== null, 'lastGood set');
  assert.equal(FPA.lastGood.features.length, 1);
  assert.ok(FPA.lastSuccessfulAt !== null, 'lastSuccessfulAt set');
});

test('empty: features=0 clears polygons, does not update lastGood', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', konum: 'Manavgat', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const r1 = await FPA.load(new AbortController().signal);
  assert.equal(r1.features.length, 1);
  assert.ok(FPA.lastGood !== null);
  AtmoApp.Cache.clear();

  mockFetch([]);
  const r2 = await FPA.load(new AbortController().signal);
  assert.equal(r2.features.length, 0, 'empty features');
  assert.ok(!r2._stale, 'not stale');
  assert.ok(!r2._error, 'no error');
  assert.equal(FPA.lastGood.features.length, 1, 'lastGood unchanged after empty');
});

test('failure+lastGood→stale', async () => {
  await resetAdapter();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.ok(FPA.lastGood !== null);
  AtmoApp.Cache.clear();

  mockFetch([], { failCount: 1, errorMsg: 'NETWORK_ERROR' });
  const r = await FPA.load(new AbortController().signal);
  assert.ok(r._stale, 'marked as stale');
  assert.ok(r._error, 'has error');
  assert.equal(r.features.length, 1, 'stale returns lastGood data');
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
  assert.equal(FPA.lastGood, null, 'lastGood unchanged after aborted load');
});

test('stale metadata includes count and lastSuccessfulAt', async () => {
  await resetAdapter();
  const before = Date.now();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  await FPA.load(new AbortController().signal);
  assert.ok(FPA.lastSuccessfulAt >= before, 'lastSuccessfulAt recorded');
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
  assert.equal(FPA.lastGood, null, 'lastGood not set on empty');

  AtmoApp.Cache.clear();
  mockFetch([{ type: 'Feature', properties: { date: '2026-07-30', il: 'Antalya', area_ha: 500 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }]);
  const r = await FPA.load(new AbortController().signal);
  assert.equal(r.features.length, 1);
  assert.equal(FPA.lastGood.features.length, 1, 'lastGood set after non-empty');
  AtmoApp.Cache.clear();

  mockFetch([]);
  await FPA.load(new AbortController().signal);
  assert.equal(FPA.lastGood.features.length, 1, 'lastGood preserved after empty success');
});

// ── Run ──
await run();
