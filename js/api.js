(function (A) {
  const U = A.Utils,
    C = A.CONFIG,
    I = A.I18n,
    T = (key, params) => I.t(key, params);
  function report(id, patch) {
    A.Events.emit("service", { id, ...patch });
  }
  function isPages() {
    return location.hostname.endsWith(".github.io");
  }
  function normalizeArray(d) {
    return Array.isArray(d) ? d : [d];
  }
  function pkey(points) {
    return points
      .map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`)
      .join(";");
  }
  async function batches(points, size, fn) {
    const out = [];
    for (let i = 0; i < points.length; i += size) {
      const part = points.slice(i, i + size);
      out.push(...(await fn(part, i / size)));
    }
    return out;
  }

  A.OpenMeteoAir = {
    variablesFor(v) {
      return v === "wildfire_share" ? ["pm10_wildfires", "pm10"] : [v];
    },
    async grid(points, variable, targetTime, signal) {
      points = points.filter(U.insideRegion.bind(U));
      if (!points.length) return [];
      const metaVar = C.smokeVariables[variable];
      if (!metaVar) throw new Error(T("error.unsupportedSmoke", { variable }));
      const vars = this.variablesFor(variable),
        started = performance.now();
      try {
        const result = await batches(points, 45, async (part, bi) => {
          const params = new URLSearchParams({
            latitude: part.map((p) => p.lat.toFixed(4)).join(","),
            longitude: part.map((p) => p.lon.toFixed(4)).join(","),
            hourly: vars.join(","),
            past_hours: "24",
            forecast_hours: "96",
            timezone: "GMT",
            domains: "cams_europe",
          });
          const key = `smoke:${C.activeCountryCode}:${variable}:${bi}:${pkey(part)}`;
          const { data, meta } = await U.fetchJson(
            `${C.openMeteoAir}?${params}`,
            { signal, cacheKey: key, ttl: C.cacheTtl.air },
          );
          return normalizeArray(data)
            .map((d, i) => {
              const idx = U.nearestTimeIndex(d.hourly?.time, targetTime);
              let value = null;
              if (idx >= 0) {
                if (variable === "wildfire_share") {
                  const wf = Number(d.hourly?.pm10_wildfires?.[idx]),
                    tot = Number(d.hourly?.pm10?.[idx]);
                  value =
                    Number.isFinite(wf) && Number.isFinite(tot) && tot > 0
                      ? U.clamp((wf / tot) * 100, 0, 100)
                      : null;
                } else {
                  const n = Number(d.hourly?.[variable]?.[idx]);
                  value = Number.isFinite(n) && n >= 0 ? n : null;
                }
              }
              return {
                lat: Number(d.latitude ?? part[i]?.lat),
                lon: Number(d.longitude ?? part[i]?.lon),
                validAt: idx >= 0 ? d.hourly.time[idx] + "Z" : null,
                value,
                unit:
                  variable === "wildfire_share"
                    ? "%"
                    : d.hourly_units?.[variable] || metaVar.unit || "",
                variable,
                source: metaVar.source,
                model: "CAMS Europe",
                resolutionKm: 11,
                dataType:
                  variable === "wildfire_share" ? "derived" : "forecast",
                cached: meta.cached,
              };
            })
            .filter((x) => U.insideRegion(x));
        });
        report("air", {
          state: "ok",
          latency: Math.round(performance.now() - started),
          count: result.filter((x) => x.value != null).length,
          note: T("api.airGrid", {
            layer: T("layers.smoke"),
            country: I.countryName(C.activeCountryCode),
          }),
        });
        return result;
      } catch (e) {
        if (e.kind !== "ABORTED")
          report("air", { state: "error", note: e.kind || e.message });
        throw e;
      }
    },
    async detail(point, targetTime, signal) {
      point = U.clampPoint(point);
      const vars = ["pm10", "pm10_wildfires"];
      const params = new URLSearchParams({
          latitude: point.lat.toFixed(5),
          longitude: point.lon.toFixed(5),
          hourly: vars.join(","),
          past_hours: "24",
          forecast_hours: "96",
          timezone: "GMT",
          domains: "cams_europe",
        }),
        key = `smokedetail:${C.activeCountryCode}:${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
      try {
        const { data, meta } = await U.fetchJson(
          `${C.openMeteoAir}?${params}`,
          { signal, cacheKey: key, ttl: C.cacheTtl.air },
        );
        const idx = U.nearestTimeIndex(data.hourly?.time, targetTime),
          values = {};
        for (const v of vars) {
          const n = Number(data.hourly?.[v]?.[idx]);
          values[v] = Number.isFinite(n) && n >= 0 ? n : null;
        }
        values.wildfire_share =
          values.pm10_wildfires != null && values.pm10 > 0
            ? U.clamp((values.pm10_wildfires / values.pm10) * 100, 0, 100)
            : null;
        const series = (data.hourly?.time || []).map((t, i) => {
          const wf = U.toNum(data.hourly?.pm10_wildfires?.[i]),
            tot = U.toNum(data.hourly?.pm10?.[i]);
          return {
            time: t + "Z",
            pm10_wildfires: wf,
            wildfire_share:
              wf != null && tot > 0 ? U.clamp((wf / tot) * 100, 0, 100) : null,
          };
        });
        report("air", {
          state: "ok",
          latency: meta.cached ? 0 : meta.latency,
          count: 1,
          note: T("api.airPoint"),
        });
        return {
          lat: Number(data.latitude),
          lon: Number(data.longitude),
          validAt: idx >= 0 ? data.hourly.time[idx] + "Z" : null,
          values,
          units: data.hourly_units || {},
          series,
          source: "CAMS European Air Quality via Open-Meteo",
          resolutionKm: 11,
          dataType: "forecast",
        };
      } catch (e) {
        if (e.kind !== "ABORTED")
          report("air", { state: "error", note: e.kind || e.message });
        throw e;
      }
    },
    async health(signal) {
      const [lat, lon] = A.activeCountry().center;
      return this.detail({ lat, lon }, new Date(), signal);
    },
  };

  A.OpenMeteoWeather = {
    async grid(points, targetTime, level = "10m", signal) {
      points = points.filter(U.insideRegion.bind(U));
      if (!points.length) return [];
      const m = C.windLevels[level] || C.windLevels["10m"],
        vars = [m.speed, m.direction];
      const started = performance.now();
      try {
        const result = await batches(points, 45, async (part, bi) => {
          const params = new URLSearchParams({
            latitude: part.map((p) => p.lat.toFixed(4)).join(","),
            longitude: part.map((p) => p.lon.toFixed(4)).join(","),
            hourly: vars.join(","),
            past_hours: "24",
            forecast_hours: "96",
            timezone: "GMT",
            wind_speed_unit: "kmh",
          });
          const { data } = await U.fetchJson(
            `${C.openMeteoWeather}?${params}`,
            {
              signal,
              cacheKey: `wind:${C.activeCountryCode}:${level}:${bi}:${pkey(part)}`,
              ttl: C.cacheTtl.weather,
            },
          );
          return normalizeArray(data)
            .map((d, i) => {
              const idx = U.nearestTimeIndex(d.hourly?.time, targetTime),
                speed = Number(d.hourly?.[m.speed]?.[idx]),
                direction = Number(d.hourly?.[m.direction]?.[idx]);
              return {
                lat: Number(d.latitude ?? part[i]?.lat),
                lon: Number(d.longitude ?? part[i]?.lon),
                validAt: idx >= 0 ? d.hourly.time[idx] + "Z" : null,
                speed: Number.isFinite(speed) ? speed : null,
                direction: Number.isFinite(direction) ? direction : null,
                level,
                label: T(m.labelKey) || m.label,
                source: "Open-Meteo Weather Forecast",
                dataType: "forecast",
              };
            })
            .filter((x) => U.insideRegion(x));
        });
        report("weather", {
          state: "ok",
          latency: Math.round(performance.now() - started),
          count: result.length,
          note: T("api.windGrid", {
            level: T(m.labelKey) || m.label,
            country: I.countryName(C.activeCountryCode),
          }),
        });
        return result;
      } catch (e) {
        if (e.kind !== "ABORTED")
          report("weather", { state: "error", note: e.kind || e.message });
        throw e;
      }
    },
    async detail(point, targetTime, signal) {
      point = U.clampPoint(point);
      const vars = [
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
        "temperature_2m",
        "relative_humidity_2m",
        "precipitation",
        "wind_speed_850hPa",
        "wind_direction_850hPa",
        "wind_speed_700hPa",
        "wind_direction_700hPa",
      ];
      const params = new URLSearchParams({
          latitude: point.lat.toFixed(5),
          longitude: point.lon.toFixed(5),
          hourly: vars.join(","),
          past_hours: "24",
          forecast_hours: "96",
          timezone: "GMT",
          wind_speed_unit: "kmh",
        }),
        key = `weatherdetail:${C.activeCountryCode}:${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
      try {
        const { data, meta } = await U.fetchJson(
          `${C.openMeteoWeather}?${params}`,
          { signal, cacheKey: key, ttl: C.cacheTtl.weather },
        );
        const idx = U.nearestTimeIndex(data.hourly?.time, targetTime),
          values = {};
        for (const v of vars) {
          const n = Number(data.hourly?.[v]?.[idx]);
          values[v] = Number.isFinite(n) ? n : null;
        }
        report("weather", {
          state: "ok",
          latency: meta.cached ? 0 : meta.latency,
          count: 1,
          note: T("api.windPoint"),
        });
        return {
          lat: Number(data.latitude),
          lon: Number(data.longitude),
          validAt: idx >= 0 ? data.hourly.time[idx] + "Z" : null,
          values,
          units: data.hourly_units || {},
          source: "Open-Meteo Weather Forecast",
          dataType: "forecast",
        };
      } catch (e) {
        if (e.kind !== "ABORTED")
          report("weather", { state: "error", note: e.kind || e.message });
        throw e;
      }
    },
    async health(signal) {
      const [lat, lon] = A.activeCountry().center;
      return this.detail({ lat, lon }, new Date(), signal);
    },
  };

  A.Geocoder = {
    async search(name, signal) {
      const country = A.activeCountry(),
        params = new URLSearchParams({
          name,
          count: "8",
          language: I.locale,
          countryCode: country.geocodeCountryCode || country.code.toLowerCase(),
        });
      try {
        const { data, meta } = await U.fetchJson(
          `${C.openMeteoGeocode}?${params}`,
          {
            signal,
            cacheKey: `geo:${country.code}:${I.locale}:${name.toLowerCase()}`,
            ttl: C.cacheTtl.geocode,
          },
        );
        const results = (data.results || []).filter((r) =>
          U.insideRegion({ lat: Number(r.latitude), lon: Number(r.longitude) }),
        );
        report("geocode", {
          state: "ok",
          latency: meta.cached ? 0 : meta.latency,
          count: results.length,
          note: T("api.geocode", { country: I.countryName(country.code) }),
        });
        return results;
      } catch (e) {
        if (e.kind !== "ABORTED")
          report("geocode", { state: "error", note: e.kind || e.message });
        throw e;
      }
    },
  };

  function parseFirmsRow(r, source, key, bbox) {
    const parsed = U.normalizeFireDetection(r, {
      sourceId: "nasa-firms",
      source: "NASA FIRMS",
      product: source,
      satellite: r.satellite || "",
      sensor: r.instrument || source,
      countryCode: C.activeCountryCode,
    });
    if (!parsed.lat || !parsed.lon || !U.insideRegion(parsed)) return null;
    if (!parsed.detectedAt) return null;
    return parsed;
  }

  const VIIRS_PRODUCTS = [
    "VIIRS_NOAA21_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_SNPP_NRT",
  ];
  const MODIS_PRODUCT = "MODIS_NRT";

  A.FirmsAdapter = {
    source() {
      return localStorage.getItem("firmsSource") || "AUTO";
    },
    setSource(v) {
      if (v === "AUTO" || C.firmsSources.includes(v))
        localStorage.setItem("firmsSource", v);
    },
    isAuto() {
      return this.source() === "AUTO";
    },
    async loadSingle(source, bbox, days, signal, key) {
      const url = `${C.firmsBase}/${encodeURIComponent(key)}/${source}/${bbox}/${days}`;
      const { data, meta } = await U.fetchText(url, {
        signal,
        cacheKey: `firms:${C.activeCountryCode}:${source}:${bbox}`,
        ttl: C.cacheTtl.firms,
      });
      const rows = U.parseCsv(data),
        out = [];
      for (const r of rows) {
        const parsed = parseFirmsRow(r, source, key, bbox);
        if (parsed) out.push(parsed);
      }
      return { data: out, meta };
    },
    async loadAll(signal) {
      const bbox = U.regionBboxString(),
        days = 2,
        key = C.firmsMapKey;
      if (!key || key === "__FIRMS_MAP_KEY__") {
        const e = new Error(T("api.mapKeyMissing"));
        e.kind = "AUTH_REQUIRED";
        report("firms", { state: "warn", note: T("api.mapKeyMissing") });
        throw e;
      }
      const started = performance.now();
      const sources = VIIRS_PRODUCTS;
      const results = await Promise.allSettled(
        sources.map((s) => {
          const ctrl = new AbortController();
          if (signal) {
            if (signal.aborted) ctrl.abort(signal.reason);
            else {
              const h = () => ctrl.abort(signal.reason);
              signal.addEventListener("abort", h, { once: true });
              ctrl.signal.addEventListener("abort", () =>
                signal.removeEventListener("abort", h),
              );
            }
          }
          const timer = setTimeout(() => ctrl.abort("timeout"), 20000);
          const sKey = key;
          return this.loadSingle(s, bbox, days, ctrl.signal, sKey).finally(() =>
            clearTimeout(timer),
          );
        }),
      );
      if (signal?.aborted) {
        const e = new Error("Request aborted");
        e.kind = "ABORTED";
        throw e;
      }
      const all = [];
      let successCount = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          all.push(...r.value.data);
          successCount++;
        }
      }
      const deduped = U.deduplicateDetections(all);
      const full = successCount === sources.length,
        fail = successCount === 0;
      report("firms", {
        state: full ? "ok" : fail ? "error" : "warn",
        latency: Math.round(performance.now() - started),
        count: deduped.length,
        note: T("api.firmsAuto", {
          country: I.countryName(C.activeCountryCode),
          success: successCount,
          total: sources.length,
          unique: deduped.length,
          raw: all.length,
        }),
      });
      return deduped;
    },
    async load(signal) {
      const bbox = U.regionBboxString(),
        days = 2,
        key = C.firmsMapKey;
      if (!key || key === "__FIRMS_MAP_KEY__") {
        const e = new Error(T("api.mapKeyMissing"));
        e.kind = "AUTH_REQUIRED";
        report("firms", { state: "warn", note: T("api.mapKeyMissing") });
        throw e;
      }
      if (this.isAuto()) return this.loadAll(signal);
      const source = this.source(),
        started = performance.now();
      try {
        const { data, meta } = await U.fetchText(
          `${C.firmsBase}/${encodeURIComponent(key)}/${source}/${bbox}/${days}`,
          {
            signal,
            cacheKey: `firms:${C.activeCountryCode}:${source}:${bbox}`,
            ttl: C.cacheTtl.firms,
          },
        );
        const rows = U.parseCsv(data),
          out = [];
        for (const r of rows) {
          const parsed = parseFirmsRow(r, source, key, bbox);
          if (parsed) out.push(parsed);
        }
        report("firms", {
          state: "ok",
          latency: Math.round(performance.now() - started),
          cached: meta.cached,
          count: out.length,
          note: T("api.firmsManual", {
            source,
            country: I.countryName(C.activeCountryCode),
          }),
        });
        return out;
      } catch (e) {
        if (e.kind !== "ABORTED")
          report("firms", {
            state: e.kind === "AUTH_REQUIRED" ? "warn" : "error",
            note: e.kind || e.message,
          });
        throw e;
      }
    },
  };

  A.EffisAdapter = {
    wmsUrl: C.effisWms,
    layer: C.effisFwiLayer,
    metadata() {
      return {
        source: "Copernicus EFFIS",
        service: "WMS",
        layer: C.effisFwiLayer,
        requiresTime: true,
        dataType: "forecast",
      };
    },
  };
})(window.AtmoApp);
