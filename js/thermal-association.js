(function (A) {
  const U = A.Utils;

  const FAMILY_BY_SOURCE = {
    "nasa-firms": "viirs-modis",
    "sentinel3a-slstr": "slstr",
    "sentinel3b-slstr": "slstr",
    "mtg-fci-frp": "mtg",
    "msg-seviri-frp": "msg",
  };

  function sensorFamilyOf(d) {
    return (
      d.sensorFamily ||
      FAMILY_BY_SOURCE[d.sourceId] ||
      (d.sensor === "SLSTR" ? "slstr" : null) ||
      "unknown"
    );
  }

  function pairRules() {
    const assoc = A.CONFIG.thermalFusion?.association || {};
    return {
      viirsToSlstr: assoc.viirsToSlstr || { maxDistanceKm: 2.5, maxTimeMinutes: 90 },
      viirsToMtg: assoc.viirsToMtg || { maxDistanceKm: 4, maxTimeMinutes: 30 },
      slstrToMtg: assoc.slstrToMtg || { maxDistanceKm: 4, maxTimeMinutes: 45 },
    };
  }

  function ruleFor(fa, fb, rules) {
    const pair = [fa, fb].sort().join("-");
    if (pair === "mtg-slstr") return rules.slstrToMtg;
    if (pair === "mtg-viirs-modis") return rules.viirsToMtg;
    if (pair === "slstr-viirs-modis") return rules.viirsToSlstr;
    return null;
  }

  function canAssociate(a, b, rule) {
    if (!rule) return false;
    const d = U.haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
    if (!(d <= rule.maxDistanceKm)) return false;
    if (!a.detectedAt || !b.detectedAt) return false;
    const dt = Math.abs(new Date(a.detectedAt) - new Date(b.detectedAt)) / 60000;
    return dt <= rule.maxTimeMinutes;
  }

  function deduplicateWithinSource(detections) {
    const seen = new Map();
    const out = [];
    for (const d of detections || []) {
      if (!d) continue;
      const key = `${d.countryCode || A.CONFIG.activeCountryCode || "TR"}:${d.product || ""}:${d.satellite || ""}:${d.detectedAt ? d.detectedAt.slice(0, 16) : ""}:${Number(d.lat).toFixed(4)}:${Number(d.lon).toFixed(4)}`;
      const best = seen.get(key);
      if (!best) {
        const copy = { ...d };
        copy.sources = [d.source || d.sourceName].filter(Boolean);
        seen.set(key, copy);
        out.push(copy);
        continue;
      }
      if (Number.isFinite(d.frpMw) && (best.frpMw == null || d.frpMw > best.frpMw)) {
        Object.assign(best, d);
        best.sources = best.sources || [];
      }
      if (d.source && !best.sources.includes(d.source)) best.sources.push(d.source);
      if (best.confidence == null && d.confidence != null) best.confidence = d.confidence;
    }
    return out;
  }

  function overMerged(members, all, rules) {
    if (members.length < 2) return false;
    const byFamily = new Map();
    for (const m of members) {
      const f = all[m].family;
      if (!byFamily.has(f)) byFamily.set(f, []);
      byFamily.get(f).push(all[m].d);
    }
    const fams = [...byFamily.keys()];
    for (let a = 0; a < fams.length; a++) {
      for (let b = a + 1; b < fams.length; b++) {
        const rule = ruleFor(fams[a], fams[b], rules);
        if (!rule) continue;
        const A = byFamily.get(fams[a]),
          B = byFamily.get(fams[b]);
        for (const x of A)
          for (const y of B) if (!canAssociate(x, y, rule)) return true;
      }
    }
    return false;
  }

  function associateAcrossSources({ bySource = {}, dedupeFirst = true } = {}) {
    const rules = pairRules();
    const all = [];
    for (const sourceId of Object.keys(bySource)) {
      let items = bySource[sourceId] || [];
      if (dedupeFirst) items = deduplicateWithinSource(items);
      for (const d of items) {
        if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) continue;
        all.push({ d, sourceId: d.sourceId || sourceId, family: sensorFamilyOf(d) });
      }
    }
    const n = all.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function unite(i, j) {
      const a = find(i),
        b = find(j);
      if (a !== b) parent[a] = b;
    }
    if (n > 1) {
      const limits = [
        rules.viirsToSlstr,
        rules.viirsToMtg,
        rules.slstrToMtg,
      ];
      const maxDistKm = Math.max(...limits.map((r) => r.maxDistanceKm));
      const maxTimeMinutes = Math.max(...limits.map((r) => r.maxTimeMinutes));
      const refLat =
        all.reduce((s, x) => s + (Number.isFinite(x.d.lat) ? x.d.lat : 0), 0) / n;
      const KM_PER_DEG = 111.32;
      const cosRef = Math.cos((refLat * Math.PI) / 180);
      const cellSizeKm = maxDistKm;
      const bucketMs = 30 * 60e3;
      const lookback = Math.ceil(maxTimeMinutes / 30);
      const times = all.map((x) =>
        x.d.detectedAt ? new Date(x.d.detectedAt).getTime() : NaN,
      );
      const grid = new Map();
      const cellKey = (lat, lon) =>
        `${Math.floor((lat * KM_PER_DEG) / cellSizeKm)}:${Math.floor(
          (lon * KM_PER_DEG * cosRef) / cellSizeKm,
        )}`;
      const bucketKey = (t) =>
        Number.isFinite(t) ? Math.floor(t / bucketMs) : -Infinity;
      for (let i = 0; i < n; i++) {
        const ck = cellKey(all[i].d.lat, all[i].d.lon);
        let buckets = grid.get(ck);
        if (!buckets) {
          buckets = new Map();
          grid.set(ck, buckets);
        }
        const bk = bucketKey(times[i]);
        let list = buckets.get(bk);
        if (!list) {
          list = [];
          buckets.set(bk, list);
        }
        list.push(i);
      }
      const offsets = [-1, 0, 1];
      for (let i = 0; i < n; i++) {
        const d = all[i].d,
          cx = Math.floor((d.lat * KM_PER_DEG) / cellSizeKm),
          cy = Math.floor((d.lon * KM_PER_DEG * cosRef) / cellSizeKm),
          b0 = bucketKey(times[i]);
        const candidates = new Set();
        for (const ox of offsets)
          for (const oy of offsets) {
            const buckets = grid.get(`${cx + ox}:${cy + oy}`);
            if (!buckets) continue;
            for (let kb = b0 - lookback; kb <= b0 + lookback; kb++) {
              const list = buckets.get(kb);
              if (!list) continue;
              for (const j of list) candidates.add(j);
            }
          }
        const sorted = [...candidates].sort((a, b) => a - b);
        for (const j of sorted) {
          if (j <= i) continue;
          const rule = ruleFor(all[i].family, all[j].family, rules);
          if (canAssociate(d, all[j].d, rule)) unite(i, j);
        }
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(i);
    }
    let counter = 0;
    const events = [];
    for (const members of groups.values()) {
      if (overMerged(members, all, rules)) continue;
      const obs = members.map((i) => all[i].d);
      const families = [...new Set(members.map((i) => all[i].family))];
      const sources = [...new Set(members.map((i) => all[i].sourceId))];
      const platforms = [
        ...new Set(
          members
            .map((i) => all[i].d.satellite || all[i].d.platform)
            .filter(Boolean),
        ),
      ];
      const maxFrpBySource = {};
      let maxFrpMw = null;
      for (const m of members) {
        const d = all[m].d;
        const src = all[m].sourceId;
        if (Number.isFinite(d.frpMw)) {
          maxFrpBySource[src] = Math.max(maxFrpBySource[src] ?? -Infinity, d.frpMw);
          maxFrpMw = maxFrpMw == null ? d.frpMw : Math.max(maxFrpMw, d.frpMw);
        }
      }
      const independentSensorCount = families.length;
      const confirmationLevel =
        independentSensorCount >= 3 ? 3 : independentSensorCount >= 2 ? 2 : 1;
      const lat = obs.reduce((s, d) => s + d.lat, 0) / obs.length;
      const lon = obs.reduce((s, d) => s + d.lon, 0) / obs.length;
      const detectedAt =
        obs
          .map((d) => d.detectedAt)
          .filter(Boolean)
          .sort()
          .shift() || null;
      events.push({
        id: `thermal-event-${++counter}`,
        lat,
        lon,
        detectedAt,
        countryCode: obs[0]?.countryCode || A.CONFIG.activeCountryCode || "TR",
        observations: obs,
        supportingSources: sources,
        supportingPlatforms: platforms,
        sensorFamilies: families,
        maxFrpBySource,
        maxFrpMw,
        observationCount: obs.length,
        independentSensorCount,
        confirmationLevel,
      });
    }
    return events;
  }

  A.ThermalAssociation = {
    deduplicateWithinSource,
    associateAcrossSources,
    sensorFamilyOf,
    pairRules,
  };
})(window.AtmoApp);
