(function (A) {
  const C = A.CONFIG,
    U = A.Utils;

  function toIsoUtc(d) {
    if (d == null) return null;
    const date = d instanceof Date ? d : new Date(d);
    return Number.isFinite(date.getTime())
      ? date.toISOString().replace(/\.\d{3}Z$/, "Z")
      : null;
  }

  function cqlTimeRange(from, to) {
    const a = toIsoUtc(from),
      b = toIsoUtc(to);
    if (!a || !b) throw new Error("eumetview-wfs: invalid time range");
    const field = C.eumetviewWfs?.timeField || "time";
    return `${field} >= '${a}' AND ${field} <= '${b}'`;
  }

  function cqlBbox(bbox) {
    if (!Array.isArray(bbox) || bbox.length < 4)
      throw new Error("eumetview-wfs: bbox must be [west,south,east,north]");
    const [west, south, east, north] = bbox.map(Number);
    if (![west, south, east, north].every(Number.isFinite))
      throw new Error("eumetview-wfs: invalid bbox");
    // GeoServer CQL BBOX uses EPSG:4326 axis order: lat,lon → south,west,north,east
    return `BBOX(geom, ${south}, ${west}, ${north}, ${east})`;
  }

  function buildCql({ bbox, from, to }) {
    const parts = [];
    if (bbox) parts.push(cqlBbox(bbox));
    if (from || to) parts.push(cqlTimeRange(from, to));
    return parts.join(" AND ");
  }

  function buildUrl({ typeNames, bbox, from, to, count, startIndex, cql }) {
    const w = C.eumetviewWfs || {},
      params = new URLSearchParams();
    params.set("service", "WFS");
    params.set("version", w.version || "2.0.0");
    params.set("request", "GetFeature");
    params.set("typeNames", typeNames);
    params.set("outputFormat", w.outputFormat || "application/json");
    if (count != null) params.set("count", String(count));
    if (startIndex != null && startIndex > 0) params.set("startIndex", String(startIndex));
    const filter = cql || buildCql({ bbox, from, to });
    if (filter) params.set("cql_filter", filter);
    return `${w.base || "https://view.eumetsat.int/geoserver/ows"}?${params.toString()}`;
  }

  function isGeoJsonCollection(data) {
    return (
      data &&
      data.type === "FeatureCollection" &&
      Array.isArray(data.features)
    );
  }

  function featureId(f) {
    return (f && (f.id || (f.properties && f.properties.id))) || null;
  }

  function dedupFeatures(features) {
    const seen = new Set();
    const out = [];
    for (const f of features) {
      const id = featureId(f);
      const key = id != null ? `id:${id}` : `g:${JSON.stringify(f.geometry || null)}:${JSON.stringify(f.properties || null)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }

  async function fetchPage(url, { signal, timeoutMs }) {
    const ctrl = new AbortController(),
      timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
    let onAbort = null;
    if (signal) {
      if (signal.aborted) ctrl.abort(signal.reason);
      else {
        onAbort = () => ctrl.abort(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")) || "";
        const e = new Error(`HTTP ${res.status}`);
        e.kind = res.status === 429 ? "RATE_LIMIT" : "HTTP_ERROR";
        e.status = res.status;
        e.body = body.slice(0, 400);
        throw e;
      }
      const data = await res.json();
      if (!isGeoJsonCollection(data)) {
        const e = new Error("eumetview-wfs: response is not a GeoJSON FeatureCollection");
        e.kind = "INVALID_RESPONSE";
        throw e;
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        const x = new Error(
          ctrl.signal.reason === "timeout"
            ? "EUMETView WFS request timed out"
            : "Request cancelled",
        );
        x.kind = ctrl.signal.reason === "timeout" ? "TIMEOUT" : "ABORTED";
        throw x;
      }
      if (e.kind) throw e;
      const x = new Error(e.message || "Network or CORS error");
      x.kind = "NETWORK_OR_CORS_ERROR";
      throw x;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }

  async function getFeature(options = {}) {
    const {
      typeNames,
      bbox,
      from,
      to,
      count = C.eumetviewWfs?.count || 2000,
      maxPages = C.eumetviewWfs?.maxPages || 20,
      signal,
      cacheKey,
      ttl = C.eumetviewWfs?.cacheTtlMs || 0,
      timeoutMs = C.eumetviewWfs?.timeoutMs || 30000,
      cql,
      onPage,
    } = options;
    if (!typeNames) throw new Error("eumetview-wfs: typeNames is required");
    const cacheId =
      cacheKey ||
      `wfs:${typeNames}:${cql || buildCql({ bbox, from, to })}:${count}`;
    if (ttl) {
      const cached = A.Cache.get(cacheId);
      if (cached)
        return { ...cached, meta: { ...cached.meta, cached: true } };
    }
    const started = performance.now();
    const features = [];
    let startIndex = 0,
      pages = 0,
      totalMatched = null,
      status = 200;
    for (;;) {
      if (signal?.aborted) {
        const e = new Error("Request aborted");
        e.kind = "ABORTED";
        throw e;
      }
      if (pages >= maxPages) {
        const e = new Error(
          `eumetview-wfs: max page limit reached (${maxPages} pages, ${features.length} features)`,
        );
        e.kind = "PAGE_LIMIT";
        e.partial = features.slice();
        throw e;
      }
      const url = buildUrl({
        typeNames,
        bbox,
        from,
        to,
        count,
        startIndex,
        cql,
      });
      const data = await fetchPage(url, { signal, timeoutMs });
      const pageFeatures = data.features || [];
      features.push(...pageFeatures);
      totalMatched =
        data.totalFeatures != null
          ? data.totalFeatures
          : data.numberMatched != null
            ? data.numberMatched
            : null;
      status = 200;
      pages++;
      onPage?.({
        page: pages,
        features: pageFeatures.length,
        totalMatched,
        startIndex,
      });
      if (pageFeatures.length < count) break;
      startIndex += count;
    }
    const unique = dedupFeatures(features);
    const latency = Math.round(performance.now() - started);
    const result = {
      features: unique,
      pages,
      totalMatched,
      cql: cql || buildCql({ bbox, from, to }),
      url: buildUrl({ typeNames, bbox, from, to, count, startIndex: 0, cql }),
    };
    if (ttl) A.Cache.set(cacheId, result, ttl);
    return { ...result, meta: { cached: false, latency, status, count: unique.length } };
  }

  A.EumetviewWfs = {
    buildUrl,
    buildCql,
    cqlTimeRange,
    cqlBbox,
    getFeature,
    dedupFeatures,
    isGeoJsonCollection,
    featureId,
  };
})(window.AtmoApp);
