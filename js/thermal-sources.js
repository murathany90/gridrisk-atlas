(function (A) {
  const C = A.CONFIG,
    U = A.Utils,
    I = A.I18n,
    T = (key, params) => I.t(key, params);

  const SOURCE_STATES = ["idle", "loading", "ok", "empty", "warn", "error", "stale"];

  const THERMAL_MODES = ["FIRMS_ONLY", "SEPARATE_SOURCES", "MULTI_SOURCE"];

  function defaultThermalMode() {
    return C.thermalSources?.mode || "FIRMS_ONLY";
  }

  function storedThermalMode() {
    try {
      const v = localStorage.getItem("thermalMode");
      return v && THERMAL_MODES.includes(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getThermalMode() {
    return storedThermalMode() || defaultThermalMode();
  }

  function setThermalMode(mode) {
    const next = THERMAL_MODES.includes(mode) ? mode : defaultThermalMode();
    try {
      localStorage.setItem("thermalMode", next);
    } catch (e) {}
    if (C.thermalFusion) C.thermalFusion.enabled = next === "MULTI_SOURCE";
    return next;
  }

  function initialState() {
    return { status: "idle", data: null, error: null, lastSuccessfulAt: null, latency: null, count: 0, seq: 0 };
  }

  class ThermalSourceRegistry {
    constructor() {
      this._adapters = new Map();
      this._state = new Map();
    }
    register(adapter) {
      if (!adapter || typeof adapter.id !== "string" || !adapter.id)
        throw new Error("ThermalSourceRegistry.register: adapter requires an id");
      if (typeof adapter.load !== "function")
        throw new Error(`ThermalSourceRegistry.register(${adapter.id}): adapter requires load()`);
      this._adapters.set(adapter.id, adapter);
      if (!this._state.has(adapter.id)) this._state.set(adapter.id, initialState());
      return adapter;
    }
    get(sourceId) {
      return this._adapters.get(sourceId) || null;
    }
    list() {
      return [...this._adapters.values()];
    }
    isEnabled(sourceId) {
      const keyMap = { "nasa-firms": "firms", "sentinel3a-slstr": "sentinel3a", "sentinel3b-slstr": "sentinel3b", "mtg-fci-frp": "mtg", "msg-seviri-frp": "msg" };
      const key = keyMap[sourceId] || sourceId;
      const meta = C.thermalSources?.meta?.[sourceId] || C.thermal?.sources?.[sourceId];
      if (meta?.required) return true;
      if (meta?.featureFlag) return !!C.thermalSources?.enabled?.[key];
      if (meta && key in (C.thermalSources?.enabled || {})) return !!C.thermalSources.enabled[key];
      return !!meta?.enabled;
    }
    async load(sourceId, request) {
      const adapter = this.get(sourceId);
      if (!adapter) throw new Error(`ThermalSourceRegistry: unknown source "${sourceId}"`);
      return adapter.load(request || {});
    }
    async loadEnabled(request) {
      const results = {};
      for (const adapter of this._adapters.values()) {
        if (!this.isEnabled(adapter.id)) continue;
        try {
          results[adapter.id] = await adapter.load(request || {});
        } catch (e) {
          results[adapter.id] = null;
        }
      }
      return results;
    }
  }

  const registry = new ThermalSourceRegistry();

  function patchState(sourceId, patch) {
    if (!registry._state.has(sourceId)) registry._state.set(sourceId, initialState());
    Object.assign(registry._state.get(sourceId), patch);
  }
  function setLoading(sourceId, seq) {
    patchState(sourceId, { status: "loading", seq, error: null });
  }
  function setResult(sourceId, seq, data, latency, requestKey) {
    if (seq !== registry._state.get(sourceId)?.seq) return false;
    const cfg = C.thermal?.sources?.[sourceId];
    const now = new Date();
    patchState(sourceId, {
      status: data && data.length ? "ok" : "empty",
      data,
      error: null,
      lastSuccessfulAt: now.toISOString(),
      latency,
      count: data ? data.length : 0,
      lastRequestKey: requestKey,
    });
    return true;
  }
  function setError(sourceId, seq, error) {
    if (seq !== registry._state.get(sourceId)?.seq) return false;
    const st = registry._state.get(sourceId);
    const hadGood = !!st.lastSuccessfulAt;
    patchState(sourceId, {
      status: hadGood ? "stale" : "error",
      error: error ? String(error.message || error) : null,
      lastErrorAt: new Date().toISOString(),
    });
    return true;
  }

  const nasaFirmsAdapter = {
    id: "nasa-firms",
    label: "NASA FIRMS",
    sensorFamily: "viirs-modis",
    supportsFrp: true,
    supportsUncertainty: false,
    defaultEnabled: true,
    async discover() {
      return { products: C.firmsSources || [] };
    },
    async load({ bbox, countryCode, startTime, endTime, signal } = {}) {
      const firms = A.FirmsAdapter;
      if (!firms || typeof firms.load !== "function")
        throw new Error("nasa-firms: A.FirmsAdapter is not available");
      const data = await firms.load(signal);
      return data;
    },
  };

  registry.register(nasaFirmsAdapter);

  function regionBboxArray() {
    const b = C.regionBounds;
    return [b.west, b.south, b.east, b.north];
  }

  function slstrFeatureToRaw(f) {
    if (!f || !f.properties) return null;
    const p = f.properties;
    const geom = f.geometry && f.geometry.coordinates;
    return Object.assign({}, p, {
      lat: U.toNum(p.Lat != null ? p.Lat : geom ? geom[1] : null),
      lon: U.toNum(p.Lon != null ? p.Lon : geom ? geom[0] : null),
      detectedAt: p.time || p.Datetime,
      receivedAt: p.Datetime,
      frp: U.toNum(p.FRP),
      frpUncertaintyMw: U.toNum(p.FRPerr),
      brightnessTemperatureK: U.toNum(p.BT),
      confidenceRaw: U.toNum(p.Confidence),
      scan: U.toNum(p.AcrossSize),
      track: U.toNum(p.AlongSize),
      qualityFlags: p.UsedChannel ? `UsedChannel=${p.UsedChannel}` : null,
      hotspotClass: p.Hotspot || null,
      dayNight: p.SZA != null ? (Number(p.SZA) > 90 ? "night" : "day") : null,
      id: f.id || null,
      cloudFraction: null,
      time: p.time,
    });
  }

  function makeSlstrAdapter(id, typeNames, opts) {
    const adapter = {
      id,
      label: opts.label,
      sensorFamily: "slstr",
      supportsFrp: true,
      supportsUncertainty: true,
      defaultEnabled: false,
      async discover() {
        return { layers: [typeNames] };
      },
      async load({ bbox, countryCode, startTime, endTime, signal } = {}) {
        const wfs = A.EumetviewWfs;
        if (!wfs) throw new Error(`${id}: A.EumetviewWfs is not available`);
        const from = startTime || new Date(Date.now() - 24 * 3600e3);
        const to = endTime || new Date();
        const box = bbox || regionBboxArray();
        const result = await wfs.getFeature({
          typeNames,
          bbox: box,
          from,
          to,
          signal,
          cacheKey: `${id}:${countryCode || C.activeCountryCode}:${from.toISOString()}:${to.toISOString()}`,
        });
        const out = [];
        for (const f of result.features || []) {
          const raw = slstrFeatureToRaw(f);
          if (!raw) continue;
          const d = U.normalizeFireDetection(raw, {
            sourceId: id,
            source: adapter.label,
            product: "SLSTR L2P FRP",
            sensor: "SLSTR",
            sensorFamily: "slstr",
            satellite: raw.Satellite || (id === "sentinel3a-slstr" ? "S3A" : "S3B"),
            countryCode: countryCode || C.activeCountryCode,
          });
          if (!d || !d.lat || !d.lon || !d.detectedAt) continue;
          if (!U.insideRegion(d)) continue;
          out.push(d);
        }
        return U.deduplicateDetections(out);
      },
    };
    return adapter;
  }

  const slstr3a = makeSlstrAdapter("sentinel3a-slstr", "copernicus:sentinel3a_slstr_level2_frp", { label: "Sentinel-3A SLSTR" });
  const slstr3b = makeSlstrAdapter("sentinel3b-slstr", "copernicus:sentinel3b_slstr_level2_frp", { label: "Sentinel-3B SLSTR" });
  registry.register(slstr3a);
  registry.register(slstr3b);

  function mtgFeatureToRaw(f) {
    if (!f || !f.properties) return null;
    const p = f.properties;
    const geom = f.geometry && f.geometry.coordinates;
    const bt = U.toNum(p.BT_mir_k != null ? p.BT_mir_k : p.BT_tir_k);
    return Object.assign({}, p, {
      lat: U.toNum(p.Lat != null ? p.Lat : geom ? geom[1] : null),
      lon: U.toNum(p.Lon != null ? p.Lon : geom ? geom[0] : null),
      detectedAt: p.time || p.Datetime,
      receivedAt: p.Datetime,
      frp: U.toNum(p.FRP),
      frpUncertaintyMw: U.toNum(p.FRPerr),
      brightnessTemperatureK: bt,
      brightTi4K: bt,
      confidenceRaw: U.toNum(p.Confidence),
      qualityFlags: null,
      hotspotClass: null,
      dayNight: p.SZA != null ? (Number(p.SZA) > 90 ? "night" : "day") : null,
      id: f.id || null,
      cloudFraction: null,
      time: p.time,
    });
  }

  const mtgFrpAdapter = {
    id: "mtg-fci-frp",
    label: "MTG FCI FRP",
    sensorFamily: "mtg",
    supportsFrp: true,
    supportsUncertainty: true,
    defaultEnabled: false,
    async discover() {
      return { layers: ["mtg_fd:frp"] };
    },
    async load({ bbox, countryCode, startTime, endTime, signal } = {}) {
      const wfs = A.EumetviewWfs;
      if (!wfs) throw new Error("mtg-fci-frp: A.EumetviewWfs is not available");
      const from = startTime || new Date(Date.now() - 24 * 3600e3);
      const to = endTime || new Date();
      const box = bbox || regionBboxArray();
      const result = await wfs.getFeature({
        typeNames: "mtg_fd:frp",
        bbox: box,
        from,
        to,
        signal,
        cacheKey: `mtg-fci-frp:${countryCode || C.activeCountryCode}:${from.toISOString()}:${to.toISOString()}`,
      });
      const out = [];
      for (const f of result.features || []) {
        const raw = mtgFeatureToRaw(f);
        if (!raw) continue;
        const d = U.normalizeFireDetection(raw, {
          sourceId: "mtg-fci-frp",
          source: mtgFrpAdapter.label,
          product: "MTG FCI FRP",
          sensor: "FCI",
          sensorFamily: "mtg",
          satellite: raw.Satellite || "MTG-I1",
          countryCode: countryCode || C.activeCountryCode,
        });
        if (!d || !d.lat || !d.lon || !d.detectedAt) continue;
        if (!U.insideRegion(d)) continue;
        out.push(d);
      }
      return out;
    },
  };
  registry.register(mtgFrpAdapter);

  let _groupSeq = 0;

  function nextGroupSeq() {
    return ++_groupSeq;
  }

  async function loadSlstrGroup(request = {}) {
    const groupSeq = nextGroupSeq();
    const ids = ["sentinel3a-slstr", "sentinel3b-slstr"];
    const bySource = {};
    const settled = await Promise.all(
      ids.map(async (id) => {
        const adapter = registry.get(id);
        setLoading(id, groupSeq);
        try {
          const data = await adapter.load({
            bbox: request.bbox,
            countryCode: request.countryCode,
            startTime: request.startTime,
            endTime: request.endTime,
            signal: request.signal,
          });
          const ok = setResult(id, groupSeq, data, request.latency, request.requestKey);
          bySource[id] = { id, status: data && data.length ? "ok" : "empty", data: data || [], error: null };
          return ok ? bySource[id] : null;
        } catch (e) {
          const ok = setError(id, groupSeq, e);
          bySource[id] = { id, status: "error", data: null, error: String((e && e.message) || e) };
          return ok ? bySource[id] : null;
        }
      }),
    );
    const sources = settled.filter(Boolean);
    const results = sources.map((s) => s.status);
    const hasData = results.includes("ok");
    const failed = results.filter((s) => s === "error").length;
    let status;
    if (failed === ids.length) status = "error";
    else if (!hasData && results.every((s) => s === "empty")) status = "empty";
    else if (failed > 0) status = "warn";
    else status = "ok";
    const merged = [];
    for (const s of sources) if (s.data) merged.push(...s.data);
    return { status, seq: groupSeq, bySource: sources, merged };
  }

  A.ThermalSources = {
    registry,
    SOURCE_STATES,
    THERMAL_MODES,
    defaultMode: defaultThermalMode,
    getMode: getThermalMode,
    setMode: setThermalMode,
    state: (sourceId) => {
      if (!registry._state.has(sourceId)) registry._state.set(sourceId, initialState());
      return registry._state.get(sourceId);
    },
    setLoading,
    setResult,
    setError,
    patchState,
    loadSlstrGroup,
    statusLabel: (status) =>
      ({
        idle: T("thermal.status.idle"),
        loading: T("thermal.status.loading"),
        ok: T("thermal.status.ok"),
        empty: T("thermal.status.empty"),
        warn: T("thermal.status.warn"),
        error: T("thermal.status.error"),
        stale: T("thermal.status.stale"),
      })[status] || T("thermal.status.idle"),
  };
})(window.AtmoApp);
