(function (A) {
  const C = A.CONFIG,
    U = A.Utils,
    I = A.I18n,
    T = (key, params) => I.t(key, params);

  const SOURCE_STATES = ["idle", "loading", "ok", "empty", "warn", "error", "stale"];

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

  A.ThermalSources = {
    registry,
    SOURCE_STATES,
    state: (sourceId) => {
      if (!registry._state.has(sourceId)) registry._state.set(sourceId, initialState());
      return registry._state.get(sourceId);
    },
    setLoading,
    setResult,
    setError,
    patchState,
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
