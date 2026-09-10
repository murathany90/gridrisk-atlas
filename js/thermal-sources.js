(function (A) {
  const C = A.CONFIG,
    U = A.Utils,
    I = A.I18n,
    T = (key, params) => I.t(key, params);

  const SOURCE_STATES = ["disabled", "idle", "loading", "ok", "empty", "partial", "warn", "stale", "unavailable", "error"];

  const THERMAL_MODES = ["FIRMS_ONLY", "SEPARATE_SOURCES", "MULTI_SOURCE"];

  function defaultMetrics() {
    return {
      rawCount: null,
      validCount: null,
      deduplicatedCount: null,
      thresholdCount: null,
      visibleCount: null,
      confirmedEventCount: null,
      latestObservationAt: null,
    };
  }

  function computeThermalMetrics(detections, opts = {}) {
    const list = Array.isArray(detections) ? detections : [];
    const threshold =
      opts.frpThreshold != null ? opts.frpThreshold : C.frpThreshold != null ? C.frpThreshold : 30;
    const metrics = defaultMetrics();
    if (!list.length) {
      metrics.rawCount = 0;
      metrics.validCount = 0;
      metrics.deduplicatedCount = 0;
      metrics.thresholdCount = 0;
      metrics.visibleCount = 0;
      return metrics;
    }
    metrics.deduplicatedCount = list.length;
    metrics.thresholdCount = list.filter(
      (d) => d && d.frp != null && Number(d.frp) >= threshold,
    ).length;
    if (opts.visibleWindow != null) {
      const end = opts.visibleWindow instanceof Date ? opts.visibleWindow.getTime() : Number(opts.visibleWindow);
      if (Number.isFinite(end)) {
        const start = end - (C.fireDetection?.visibleObservationHours || 3) * 3600e3;
        metrics.visibleCount = list.filter((d) => {
          const t = d && d.detectedAt ? Date.parse(d.detectedAt) : NaN;
          return Number.isFinite(t) && t >= start && t <= end;
        }).length;
      }
    }
    let latest = null;
    for (const d of list) {
      const t = d && d.detectedAt ? Date.parse(d.detectedAt) : NaN;
      if (Number.isFinite(t) && (latest == null || t > Date.parse(latest)))
        latest = d.detectedAt;
    }
    metrics.latestObservationAt = latest;
    return metrics;
  }

  function computeMultiSensorMetrics(events = []) {
    const list = Array.isArray(events) ? events : [];
    const metrics = defaultMetrics();
    metrics.deduplicatedCount = list.length;
    const confirmedByProduct = {};
    const confirmedBySource = {};
    const allFamilies = new Set();
    let latest = null;
    for (const e of list) {
      const families = Array.isArray(e.sensorFamilies) ? e.sensorFamilies : [];
      for (const f of families) allFamilies.add(f);
      const t = e.latestDetectedAt || e.detectedAt;
      if (t && (latest == null || new Date(t) > new Date(latest)))
        latest = t;
    }
    const confirmed = list.filter(e => (e.independentSensorCount ?? (e.sensorFamilies?.length || 0)) >= 2);
    for (const e of confirmed) {
      const prods = new Set(
        (Array.isArray(e.observations) ? e.observations : [])
          .map((d) => d && d.product)
          .filter(Boolean),
      );
      for (const p of prods) confirmedByProduct[p] = (confirmedByProduct[p] || 0) + 1;
      const srcs = Array.isArray(e.supportingSources) ? e.supportingSources : [];
      for (const s of srcs) confirmedBySource[s] = (confirmedBySource[s] || 0) + 1;
    }
    metrics.confirmedEventCount = confirmed.length;
    metrics.latestObservationAt = latest;
    return {
      metrics,
      associationGroupCount: list.length,
      singleSensorGroupCount: list.length - confirmed.length,
      totalMatchedEvents: confirmed.length,
      confirmedEventCount: confirmed.length,
      twoFamilyEvents: confirmed.filter((e) => (e.independentSensorCount ?? (e.sensorFamilies?.length || 0)) === 2).length,
      threePlusFamilyEvents: confirmed.filter((e) => (e.independentSensorCount ?? (e.sensorFamilies?.length || 0)) >= 3).length,
      twoSensorEventCount: confirmed.filter((e) => (e.independentSensorCount ?? (e.sensorFamilies?.length || 0)) === 2).length,
      threePlusSensorEventCount: confirmed.filter((e) => (e.independentSensorCount ?? (e.sensorFamilies?.length || 0)) >= 3).length,
      familiesUsed: [...allFamilies].sort(),
      confirmedByProduct,
      confirmedBySource,
    };
  }

  const THERMAL_ROW_DEFS = [
    { id: "viirs-noaa21", sourceId: "nasa-firms", product: "VIIRS_NOAA21_NRT", labelKey: "thermal.source.noaa21", familyKey: "thermal.family.viirs", riskRoleKey: "thermal.role.primary" },
    { id: "viirs-noaa20", sourceId: "nasa-firms", product: "VIIRS_NOAA20_NRT", labelKey: "thermal.source.noaa20", familyKey: "thermal.family.viirs", riskRoleKey: "thermal.role.primary" },
    { id: "viirs-snpp", sourceId: "nasa-firms", product: "VIIRS_SNPP_NRT", labelKey: "thermal.source.snpp", familyKey: "thermal.family.viirs", riskRoleKey: "thermal.role.primary" },
    { id: "modis", sourceId: "nasa-firms", product: "MODIS_NRT", labelKey: "thermal.source.modis", familyKey: "thermal.family.modis", riskRoleKey: "thermal.role.verification", manualOnly: true },
    { id: "sentinel3a-slstr", sourceId: "sentinel3a-slstr", labelKey: "thermal.source.sentinel3a", familyKey: "thermal.family.slstr", riskRoleKey: "thermal.role.verification" },
    { id: "sentinel3b-slstr", sourceId: "sentinel3b-slstr", labelKey: "thermal.source.sentinel3b", familyKey: "thermal.family.slstr", riskRoleKey: "thermal.role.verification" },
    { id: "mtg-fci-frp", sourceId: "mtg-fci-frp", labelKey: "thermal.source.mtg", familyKey: "thermal.family.fci", riskRoleKey: "thermal.role.temporal" },
    { id: "multi-sensor", sourceId: "multi-sensor", labelKey: "thermal.source.multisensor", familyKey: "thermal.family.derived", riskRoleKey: "thermal.role.derived" },
  ];

  function thermalRows() {
    const mode = getThermalMode();
    const frpThreshold =
      (A.app && A.app.state && A.app.state.frpThreshold != null
        ? A.app.state.frpThreshold
        : C.frpThreshold) ?? 30;
    const firmsSourceRaw =
      A.FirmsAdapter && typeof A.FirmsAdapter.source === "function"
        ? A.FirmsAdapter.source()
        : null;
    const firmsSource = typeof firmsSourceRaw === "string" && firmsSourceRaw ? firmsSourceRaw : "AUTO";
    const firmsState = registry._state.get("nasa-firms") || initialState();
    const firmsLoading = firmsState.status === "loading";
    const msState = registry._state.get("multi-sensor") || initialState();
    const msRaw = msState.metrics || {};
    const msSummary = {
      associationGroupCount: msRaw.associationGroupCount ?? 0,
      confirmedEventCount: msRaw.confirmedEventCount ?? 0,
      totalMatchedEvents: msRaw.totalMatchedEvents ?? 0,
      twoFamilyEvents: msRaw.twoSensorEventCount ?? msRaw.twoFamilyEvents ?? 0,
      threePlusFamilyEvents: msRaw.threePlusSensorEventCount ?? msRaw.threePlusFamilyEvents ?? 0,
      familiesUsed: msRaw.familiesUsed || [],
      confirmedByProduct: msRaw.confirmedByProduct || {},
      confirmedBySource: msRaw.confirmedBySource || {},
    };
    return THERMAL_ROW_DEFS.map((def) => {
      if (def.product) {
        const product = def.product;
        const p = (firmsState.products && firmsState.products[product]) || null;
        let status = "idle";
        let note = null;
        let metrics = defaultMetrics();
        if (def.manualOnly && firmsSource !== "MODIS_NRT") {
          status = "disabled";
          note = T("thermal.note.modisManual");
        } else if (!def.manualOnly && firmsSource !== "AUTO" && firmsSource !== product) {
          status = "disabled";
          note = T("thermal.note.notInManualSource", { source: firmsSource });
        } else if (firmsLoading) {
          status = "loading";
        } else if (p) {
          status = p.status;
          metrics = p.metrics || defaultMetrics();
        } else if (def.manualOnly) {
          status = "idle";
          note = T("thermal.note.modisManual");
        }
        if (status === "ok" && !def.manualOnly && firmsSource === "AUTO")
          note = T("thermal.note.autoLoaded");
        metrics.confirmedEventCount = msSummary.confirmedByProduct[product] ?? null;
        const riskRoleKey =
          def.id === "modis"
            ? firmsSource === "MODIS_NRT"
              ? "thermal.role.primaryManual"
              : "thermal.role.verificationManual"
            : def.riskRoleKey;
        return {
          ...def,
          riskRoleKey,
          status,
          note,
          metrics,
          count: p ? p.count : null,
          latency: p ? p.latency : null,
          lastSuccessfulAt: p ? p.lastSuccessfulAt : firmsState.lastSuccessfulAt,
          error: p ? p.error : null,
        };
      }
      if (def.id === "multi-sensor") {
        let status = msState.status;
        if (mode !== "MULTI_SOURCE") status = "disabled";
        const metrics = {
          rawCount: null,
          validCount: null,
          deduplicatedCount: msSummary.totalMatchedEvents,
          thresholdCount: null,
          visibleCount: null,
          confirmedEventCount: msSummary.confirmedEventCount,
          latestObservationAt: msState.metrics ? msState.metrics.latestObservationAt : null,
        };
        const note =
          status === "ok" || status === "empty"
            ? T("thermal.note.multisensor", {
                total: I.formatNumber(msSummary.associationGroupCount),
                confirmed: I.formatNumber(msSummary.confirmedEventCount),
                two: I.formatNumber(msSummary.twoFamilyEvents),
                three: I.formatNumber(msSummary.threePlusFamilyEvents),
                families: msSummary.familiesUsed.length
                  ? msSummary.familiesUsed.join(", ")
                  : "—",
              })
            : status === "disabled"
              ? T("thermal.note.multisensorDisabled")
              : null;
        return { ...def, status, note, metrics, count: msState.count, lastSuccessfulAt: msState.lastSuccessfulAt, error: msState.error };
      }
      const st = registry._state.get(def.sourceId) || initialState();
      let status = st.status;
      if (mode === "FIRMS_ONLY") status = "disabled";
      if (def.id === "mtg-fci-frp" && !registry.isEnabled("mtg-fci-frp"))
        status = "disabled";
      const metrics = {
        ...defaultMetrics(),
        ...(st.metrics || {}),
      };
      metrics.confirmedEventCount = msSummary.confirmedBySource[def.sourceId] ?? null;
      return { ...def, status, note: st.note || null, metrics, count: st.count, latency: st.latency, lastSuccessfulAt: st.lastSuccessfulAt, error: st.error };
    });
  }

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
    if (A.app && A.app.ui && typeof A.app.ui.renderThermalSources === "function") {
      try {
        A.app.ui.renderThermalSources();
      } catch (_) {}
    }
    return next;
  }

  function planThermalRequests({
    mode = getThermalMode(),
  } = {}) {
    if (mode === "FIRMS_ONLY") return { slstrIds: [], mtg: false };
    const slstrIds = [];
    // These are data-source switches, deliberately separate from the raw
    // S3A/S3B map-marker toggles.  Hiding a diagnostic layer must never
    // remove that sensor from the detection engine.
    if (registry.isEnabled("sentinel3a-slstr"))
      slstrIds.push("sentinel3a-slstr");
    if (registry.isEnabled("sentinel3b-slstr"))
      slstrIds.push("sentinel3b-slstr");
    return { slstrIds, mtg: registry.isEnabled("mtg-fci-frp") };
  }

  function thermalWindowKey(countryCode, selectedTime) {
    const d =
      selectedTime instanceof Date ? selectedTime : new Date(selectedTime);
    const t = Number.isFinite(d.getTime()) ? d.getTime() : Date.now();
    const end = new Date(t),
      start = new Date(t - (C.fireDetection?.eventTrackingHours || 48) * 3600e3);
    return `${countryCode || "?"}:${start.toISOString()}:${end.toISOString()}`;
  }

  const ORCHESTRATOR_KEYS = {
    ok: "thermal.orchestrator.slstrOk",
    warn: "thermal.orchestrator.warn",
    empty: "thermal.orchestrator.empty",
    error: "thermal.orchestrator.error",
  };

  function orchestratorStatusKey(status) {
    return ORCHESTRATOR_KEYS[status] || null;
  }

  function associationSources({
    fireData = [],
    slstrData = [],
    mtgFrpData = [],
  } = {}) {
    const bySource = { "nasa-firms": fireData };
    const s3a = slstrData.filter((d) => d.satellite === "S3A"),
      s3b = slstrData.filter((d) => d.satellite === "S3B");
    if (s3a.length) bySource["sentinel3a-slstr"] = s3a;
    if (s3b.length) bySource["sentinel3b-slstr"] = s3b;
    if (mtgFrpData.length) bySource["mtg-fci-frp"] = mtgFrpData;
    return bySource;
  }

  function initialState() {
    return { status: "idle", data: null, error: null, lastSuccessfulAt: null, latency: null, count: 0, seq: 0, metrics: defaultMetrics(), products: null, note: null, lastErrorAt: null };
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
    if (A.app && A.app.ui && typeof A.app.ui.renderThermalSources === "function") {
      try {
        A.app.ui.renderThermalSources();
      } catch (_) {}
    }
  }
  function setLoading(sourceId, seq) {
    patchState(sourceId, { status: "loading", seq, error: null });
  }
  function setResult(sourceId, seq, data, latency, requestKey, opts = {}) {
    if (seq !== registry._state.get(sourceId)?.seq) return false;
    const list = Array.isArray(data) ? data : [];
    const threshold =
      (A.app && A.app.state && A.app.state.frpThreshold != null
        ? A.app.state.frpThreshold
        : C.frpThreshold) ?? 30;
    const metrics = computeThermalMetrics(list, {
      frpThreshold: threshold,
      visibleWindow: opts.visibleWindow,
    });
    if (list.metrics && typeof list.metrics === "object")
      Object.assign(metrics, list.metrics);
    const now = new Date();
    patchState(sourceId, {
      status: list.length ? "ok" : "empty",
      data: list,
      error: null,
      lastSuccessfulAt: now.toISOString(),
      latency,
      count: list.length,
      lastRequestKey: requestKey,
      metrics,
      note: opts.note != null ? opts.note : null,
      lastErrorAt: null,
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
      const data = await firms.load(signal, { bbox, countryCode, startTime, endTime });
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
        const features = result.features || [];
        const out = [];
        for (const f of features) {
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
        const deduped = U.deduplicateDetections(out);
        Object.defineProperty(deduped, "metrics", {
          value: {
            rawCount: features.length,
            validCount: out.length,
            deduplicatedCount: deduped.length,
          },
          enumerable: false,
        });
        return deduped;
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

  function mtgHistoryWindow(startTime, endTime) {
    // Live-probed 2026-09-10: the mtg_fd:frp table answers TIME-only filters
    // in ~300 ms but bbox-combined queries hit HTTP 503 / 60 s timeouts, so
    // the MTG adapter queries TIME-only over a bounded recent window and
    // filters to the region client-side (insideRegion in load()).
    const hours = C.eumetviewWfs?.mtgHistoryHours || 6;
    const to = endTime instanceof Date ? endTime : new Date(endTime || Date.now());
    const earliest = new Date(to.getTime() - hours * 3600e3);
    const wanted = startTime ? new Date(startTime) : earliest;
    const from = new Date(Math.max(wanted.getTime(), earliest.getTime()));
    return { from, to, capped: wanted.getTime() < earliest.getTime() };
  }

  function mtgTimeSlices(from, to, sliceMs = 30 * 60e3) {
    const out = [];
    let cursor = new Date(from).getTime();
    const end = new Date(to).getTime();
    while (cursor < end) {
      const next = Math.min(cursor + sliceMs, end);
      out.push([new Date(cursor), new Date(next)]);
      cursor = next;
    }
    return out;
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
    async load({ countryCode, startTime, endTime, signal } = {}) {
      const wfs = A.EumetviewWfs;
      if (!wfs) throw new Error("mtg-fci-frp: A.EumetviewWfs is not available");
      const window = mtgHistoryWindow(startTime, endTime);
      // Sequential 30-minute TIME-only slices: large scans on mtg_fd:frp
      // intermittently return HTTP 503, so one failed slice must not fail
      // the whole source.  Region filtering stays client-side (insideRegion).
      const slices = mtgTimeSlices(window.from, window.to);
      const features = [];
      let failedSlices = 0;
      // Live endpoint behavior: a slice usually answers in <1 s but large
      // scans intermittently hang; each slice gets its own short timeout so
      // one slow slice cannot stall the whole source.  Sequential on
      // purpose: parallel bursts make the server shed load (HTTP 503).
      const sliceTimeoutMs = C.eumetviewWfs?.mtgSliceTimeoutMs || 11000;
      for (const [sliceFrom, sliceTo] of slices) {
        try {
          const result = await wfs.getFeature({
            typeNames: "mtg_fd:frp",
            bbox: null,
            from: sliceFrom,
            to: sliceTo,
            signal,
            timeoutMs: sliceTimeoutMs,
            count: 3000,
            maxPages: 2,
            cacheKey: `mtg-fci-frp:${countryCode || C.activeCountryCode}:${sliceFrom.toISOString()}:${sliceTo.toISOString()}`,
          });
          features.push(...(result.features || []));
        } catch (e) {
          if (signal?.aborted) throw e;
          failedSlices++;
        }
      }
      if (!features.length && failedSlices > 0) {
        const err = new Error("mtg-fci-frp: all time slices failed");
        err.kind = "SLICE_ERROR";
        throw err;
      }
      const out = [];
      for (const f of features) {
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
      const deduped = U.deduplicateDetections(out);
      Object.defineProperty(deduped, "metrics", {
        value: {
          rawCount: features.length,
          validCount: out.length,
          deduplicatedCount: deduped.length,
          sliceFailures: failedSlices,
          sliceTotal: slices.length,
        },
        enumerable: false,
      });
      return deduped;
    },
  };
  registry.register(mtgFrpAdapter);

  let _groupSeq = 0;

  function nextGroupSeq() {
    return ++_groupSeq;
  }

  async function loadSlstrGroup(request = {}, enabledIds = ["sentinel3a-slstr", "sentinel3b-slstr"]) {
    const groupSeq = nextGroupSeq();
    const ids = enabledIds.filter((id) => registry.get(id));
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
          const ok = setResult(id, groupSeq, data, request.latency, request.requestKey, { visibleWindow: request.endTime });
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
    if (!ids.length) status = "empty";
    else if (failed === ids.length) status = "error";
    else if (!hasData && results.length && results.every((s) => s === "empty")) status = "empty";
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
    THERMAL_ROW_DEFS,
    defaultThermalMode: defaultThermalMode,
    getMode: getThermalMode,
    setMode: setThermalMode,
    planThermalRequests,
    thermalWindowKey,
    mtgHistoryWindow,
    mtgTimeSlices,
    orchestratorStatusKey,
    associationSources,
    state: (sourceId) => {
      if (!registry._state.has(sourceId)) registry._state.set(sourceId, initialState());
      return registry._state.get(sourceId);
    },
    setLoading,
    setResult,
    setError,
    patchState,
    loadSlstrGroup,
    defaultMetrics,
    computeThermalMetrics,
    computeMultiSensorMetrics,
    thermalRows,
    statusLabel: (status) =>
      ({
        disabled: T("thermal.status.disabled"),
        idle: T("thermal.status.idle"),
        loading: T("thermal.status.loading"),
        ok: T("thermal.status.ok"),
        empty: T("thermal.status.empty"),
        partial: T("thermal.status.partial"),
        warn: T("thermal.status.warn"),
        stale: T("thermal.status.stale"),
        unavailable: T("thermal.status.unavailable"),
        error: T("thermal.status.error"),
      })[status] || T("thermal.status.idle"),
  };
})(window.AtmoApp);
