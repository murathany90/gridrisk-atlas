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
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const rule = ruleFor(all[i].family, all[j].family, rules);
        if (canAssociate(all[i].d, all[j].d, rule)) unite(i, j);
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
