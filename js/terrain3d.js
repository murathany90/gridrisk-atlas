/* Real DEM terrain renderer. Leaflet remains the authoritative 2D map and data owner. */
(function (A) {
  const C = A.CONFIG;
  const T = (key, params) => A.I18n.t(key, params);
  const EMPTY = () => ({ type: "FeatureCollection", features: [] });

  class Terrain3DManager {
    constructor(mapManager) {
      this.owner = mapManager;
      this.map = null;
      this.loading = false;
      this.enabled = false;
      this.firstVisualReady = false;
      this.container = null;
      this.toggle = null;
      this._resizeHandler = () => this.map?.resize();
      this._demSuccessSeen = false;
      this._demErrorCount = 0;
      this._demWarned = false;
      this._baseSuccessSeen = false;
      this._baseErrorCount = 0;
      this._baseFallbackTriggered = false;
      this._baseStyleId = null;
      this._selectedBaseStyleId = null;
      this._firstFrameWait = null;
      this._firstFrameTimer = null;
      this._styleInitTimer = null;
      this._renderCount = 0;
      this._baseSuccessRender = -1;
      this._demSuccessRender = -1;
      this._failureActive = false;
      this._otherMapErrorWarned = false;
      this._contextCanvas = null;
      this._contextLostHandler = (event) => this.handleContextLost(event);
      this._contextRestoredHandler = () => this.handleContextRestored();
    }

    attach() {
      this.container = document.getElementById("map3d");
      this.toggle = document.getElementById("terrain3dToggle");
      this.refreshUi();
    }

    refreshUi(state = this.loading ? "loading" : this.enabled ? "on" : "off") {
      if (!this.toggle) return;
      const disabled = !C.terrain3d?.enabled || state === "loading";
      const key =
        state === "loading"
          ? "terrain3d.loading"
          : state === "on"
            ? "terrain3d.hide"
            : "terrain3d.show";
      const ariaKey = state === "on" ? "terrain3d.hideAria" : "terrain3d.showAria";
      this.toggle.disabled = disabled;
      this.toggle.setAttribute("aria-pressed", state === "on" ? "true" : "false");
      this.toggle.setAttribute("aria-label", T(ariaKey));
      this.toggle.dataset.i18n = key;
      this.toggle.dataset.i18nAriaLabel = ariaKey;
      this.toggle.textContent = T(key);
    }

    async toggleMode() {
      if (this.loading) return false;
      if (this.enabled) {
        this.disable();
        return false;
      }
      return this.enable();
    }

    async enable() {
      if (!C.terrain3d?.enabled || this.loading || this.enabled) return this.enabled;
      this.loading = true;
      this.refreshUi("loading");
      this.resetLoadHealth();
      try {
        const maplibregl = await this.ensureMapLibreLoaded();
        if (!maplibregl?.Map || !this.webglSupported() || (maplibregl.supported && !maplibregl.supported({ failIfMajorPerformanceCaveat: true }))) {
          throw new Error("WEBGL_UNAVAILABLE");
        }
        await this.createMap(maplibregl);
        await this.waitForFirstUsableFrame(this.map);
        this.enabled = true;
        this.show3d();
        this.sync({ camera: false });
        this.refreshUi("on");
        return true;
      } catch (error) {
        if (!this._failureActive) {
          const kind = error?.message === "WEBGL_UNAVAILABLE"
            ? "unavailable"
            : error?.message === "FIRST_FRAME_BASE_FAILED"
              ? "base"
              : error?.message === "FIRST_FRAME_DEM_FAILED"
                ? "dem"
                : "load";
          this.fail(kind);
        }
        return false;
      } finally {
        this.loading = false;
        if (!this.enabled) this.refreshUi("off");
      }
    }

    async ensureMapLibreLoaded() {
      if (window.maplibregl) return window.maplibregl;
      const base = C.terrain3d.cdnBase;
      await this.loadAsset("maplibre-gl-css", `${base}/maplibre-gl.css`, "link");
      const moduleApi = await import(C.terrain3d.moduleUrl || `${base}/maplibre-gl.mjs`);
      const maplibregl = moduleApi?.default?.Map ? moduleApi.default : moduleApi?.Map ? moduleApi : window.maplibregl;
      if (!maplibregl?.Map) throw new Error("MAPLIBRE_MISSING");
      window.maplibregl = maplibregl;
      return maplibregl;
    }

    webglSupported() {
      try {
        const canvas = document.createElement("canvas");
        return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
      } catch (error) {
        return false;
      }
    }

    resetLoadHealth() {
      clearTimeout(this._firstFrameTimer);
      clearTimeout(this._styleInitTimer);
      this._firstFrameTimer = null;
      this._styleInitTimer = null;
      this._demSuccessSeen = false;
      this._demErrorCount = 0;
      this._demWarned = false;
      this._baseSuccessSeen = false;
      this._baseErrorCount = 0;
      this._baseFallbackTriggered = false;
      this.firstVisualReady = false;
      this._renderCount = 0;
      this._baseSuccessRender = -1;
      this._demSuccessRender = -1;
      this._failureActive = false;
      this._otherMapErrorWarned = false;
    }

    beginInitialFrameWatch(map) {
      const deadline = Date.now() + 12000;
      const watch = () => {
        if (this.map !== map || this.firstVisualReady) return;
        const remaining = deadline - Date.now();
        if (!this._baseSuccessSeen && !this._baseFallbackTriggered) {
          this.activateBaseFallback();
          this.scheduleInitialFrameWatch(map, deadline);
          return;
        }
        if (remaining <= 0) {
          this.fail(!this._baseSuccessSeen ? "base" : !this._demSuccessSeen ? "dem" : "load");
          return;
        }
        this.scheduleInitialFrameWatch(map, deadline);
      };
      this._initialFrameWatch = watch;
      this.scheduleInitialFrameWatch(map, deadline);
    }

    scheduleInitialFrameWatch(map, deadline) {
      clearTimeout(this._firstFrameTimer);
      const remaining = Math.max(0, deadline - Date.now());
      const delay = this._baseFallbackTriggered ? remaining : Math.min(6000, remaining);
      this._firstFrameTimer = setTimeout(() => this._initialFrameWatch?.(map), delay);
    }

    markDemSuccess() {
      if (this._demSuccessSeen) return;
      this._demSuccessSeen = true;
      this._demSuccessRender = this._renderCount;
      this._firstFrameWait?.check?.();
    }

    handleDemError() {
      this._demErrorCount += 1;
      if (!this._demSuccessSeen) {
        // Fail only when initial terrain loading is clearly unavailable, not for one tile retry.
        if (this._demErrorCount >= 4) this.fail("dem");
        return;
      }
      if (!this._demWarned) {
        this._demWarned = true;
        A.Events.emit("service", { id: "terrain3d", state: "warn", count: null });
      }
    }

    markBaseSuccess() {
      if (this._baseSuccessSeen) return;
      this._baseSuccessSeen = true;
      this._baseSuccessRender = this._renderCount;
      this._firstFrameWait?.check?.();
    }

    handleBaseError() {
      if (this._baseSuccessSeen) {
        A.Events.emit("service", { id: "terrain3d-base", state: "warn", count: null });
        return;
      }
      this._baseErrorCount += 1;
      if (this._baseErrorCount < 4) return;
      if (!this._baseFallbackTriggered) {
        this.activateBaseFallback();
        return;
      }
      this.fail("base");
    }

    handleMapError(event) {
      const sourceId = event?.sourceId || event?.error?.sourceId;
      if (sourceId === "terrainSource" || sourceId === "hillshadeSource") {
        this.handleDemError();
        return;
      }
      if (sourceId === "base-raster") {
        this.handleBaseError();
        return;
      }
      if (sourceId === "operational-imagery") {
        A.Events.emit("service", { id: "terrain3d-imagery", state: "warn", count: null });
        return;
      }
      const message = String(event?.error?.message || event?.error || "");
      if (/webgl.*context|context.*lost/i.test(message)) {
        this.fail("load");
      } else if (!this._otherMapErrorWarned) {
        this._otherMapErrorWarned = true;
        A.Events.emit("service", { id: "terrain3d", state: "warn", count: null });
      }
    }

    isSuccessfulTileEvent(map, sourceId, event) {
      // MapLibre emits `content` even for some failed raster requests. A loaded tile is
      // the positive signal; fully loaded source content is a safe fallback for mocks/API variants.
      return event?.tile?.state === "loaded" || Boolean(
        event?.sourceDataType === "content" &&
        event?.isSourceLoaded &&
        map.isSourceLoaded?.(sourceId),
      );
    }

    loadAsset(id, url, type) {
      const existing = document.getElementById(id);
      if (existing?.dataset.loaded === "true") return Promise.resolve();
      if (existing?.dataset.failed === "true") return Promise.reject(new Error("MAPLIBRE_ASSET_FAILED"));
      return new Promise((resolve, reject) => {
        const asset = existing || document.createElement(type === "link" ? "link" : "script");
        const done = () => {
          asset.dataset.loaded = "true";
          resolve();
        };
        const fail = () => {
          asset.dataset.failed = "true";
          reject(new Error("MAPLIBRE_ASSET_FAILED"));
        };
        asset.addEventListener("load", done, { once: true });
        asset.addEventListener("error", fail, { once: true });
        if (!existing) {
          asset.id = id;
          if (type === "link") {
            asset.rel = "stylesheet";
            asset.href = url;
          } else {
            asset.src = url;
            asset.async = true;
          }
          document.head.appendChild(asset);
        }
      });
    }

    leafletCamera() {
      const center = this.owner.map?.getCenter();
      return center
        ? { center: [center.lng, center.lat], zoom: this.owner.map.getZoom() }
        : { center: [C.defaultCenter[1], C.defaultCenter[0]], zoom: C.defaultZoom };
    }

    // Leaflet and MapLibre use the same WebMercator zoom scale, so no offset is required.
    mapLibreZoom(leafletZoom) {
      return Number(leafletZoom);
    }

    baseTiles(key = this.owner.baseKey) {
      const cfg = C.baseMaps[key] || C.baseMaps.satellite;
      const subdomains = String(cfg.subdomains || "").split("").filter(Boolean);
      const urls = subdomains.length ? subdomains.map((s) => cfg.url.replace("{s}", s)) : [cfg.url];
      return { cfg, tiles: urls.map((url) => url.replace("{r}", "")) };
    }

    baseStyleId(base, key = this.owner.baseKey) {
      return `${key}:${base.tiles.join("|")}`;
    }

    baseRasterSource(base) {
      return {
        type: "raster",
        tiles: base.tiles,
        tileSize: 256,
        maxzoom: base.cfg.maxZoom,
        attribution: base.cfg.attribution,
      };
    }

    terrainSource(id) {
      return {
        type: "raster-dem",
        tiles: C.terrain3d.tiles,
        encoding: C.terrain3d.encoding,
        tileSize: C.terrain3d.tileSize,
        maxzoom: C.terrain3d.maxZoom,
        attribution: C.terrain3d.attribution,
      };
    }

    style() {
      const base = this.baseTiles();
      this._selectedBaseStyleId = this.baseStyleId(base);
      this._baseStyleId = this._selectedBaseStyleId;
      const sources = {
        "base-raster": this.baseRasterSource(base),
        terrainSource: this.terrainSource("terrainSource"),
        hillshadeSource: this.terrainSource("hillshadeSource"),
        "country-boundary": { type: "geojson", data: EMPTY() },
        "grid-400": { type: "geojson", data: EMPTY() },
        "grid-154": { type: "geojson", data: EMPTY() },
        substations: { type: "geojson", data: EMPTY() },
        "fire-events": { type: "geojson", data: EMPTY() },
        "risk-events": { type: "geojson", data: EMPTY() },
      };
      const layers = [
        { id: "base-raster", type: "raster", source: "base-raster" },
      ];
      if (C.terrain3d.hillshade) {
        layers.push({
          id: "terrain-hillshade",
          type: "hillshade",
          source: "hillshadeSource",
          paint: { "hillshade-exaggeration": 0.35 },
        });
      }
      layers.push(
        {
          id: "country-boundary-line",
          type: "line",
          source: "country-boundary",
          paint: { "line-color": "#60a5fa", "line-width": 1.5, "line-opacity": 0.7 },
        },
        {
          id: "grid-400-line",
          type: "line",
          source: "grid-400",
          paint: { "line-color": C.gridSources["400"].color, "line-width": C.gridSources["400"].weight, "line-opacity": 0.84 },
        },
        {
          id: "grid-154-line",
          type: "line",
          source: "grid-154",
          paint: { "line-color": C.gridSources["154"].color, "line-width": C.gridSources["154"].weight, "line-opacity": 0.78 },
        },
        {
          id: "substations-circle",
          type: "circle",
          source: "substations",
          paint: { "circle-radius": 3, "circle-color": "#0b1722", "circle-stroke-color": "#9ca3af", "circle-stroke-width": 1 },
        },
        {
          id: "risk-events-circle",
          type: "circle",
          source: "risk-events",
          paint: { "circle-radius": ["get", "radius"], "circle-color": ["get", "color"], "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
        },
        {
          id: "fire-events-circle",
          type: "circle",
          source: "fire-events",
          paint: { "circle-radius": ["get", "radius"], "circle-color": ["get", "color"], "circle-opacity": ["get", "opacity"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 },
        },
      );
      return { version: 8, sources, layers };
    }

    async createMap(maplibregl) {
      this.container ||= document.getElementById("map3d");
      if (!this.container) throw new Error("TERRAIN_CONTAINER_MISSING");
      this.container.classList.remove("hidden");
      this.container.classList.add("preparing");
      const camera = this.leafletCamera();
      const map = new maplibregl.Map({
        container: this.container,
        style: this.style(),
        center: camera.center,
        zoom: this.mapLibreZoom(camera.zoom),
        pitch: C.terrain3d.pitch,
        bearing: C.terrain3d.bearing,
        attributionControl: true,
      });
      this.map = map;
      const canvas = map.getCanvas?.();
      if (canvas) {
        this._contextCanvas = canvas;
        canvas.addEventListener("webglcontextlost", this._contextLostHandler, false);
        canvas.addEventListener("webglcontextrestored", this._contextRestoredHandler, false);
      }
      map.on("error", (event) => this.handleMapError(event));
      map.on("sourcedata", (event) => {
        const sourceId = event?.sourceId;
        if (
          (sourceId === "terrainSource" || sourceId === "hillshadeSource") &&
          this.isSuccessfulTileEvent(map, sourceId, event)
        ) this.markDemSuccess();
        if (
          sourceId === "base-raster" &&
          this.isSuccessfulTileEvent(map, sourceId, event)
        ) this.markBaseSuccess();
      });
      map.on("render", () => {
        this._renderCount += 1;
        this._firstFrameWait?.check?.();
      });
      await new Promise((resolve, reject) => {
        let initialized = false;
        const ready = () => {
          if (initialized || this.map !== map) return;
          initialized = true;
          clearTimeout(this._styleInitTimer);
          this._styleInitTimer = null;
          try {
            map.setTerrain({ source: "terrainSource", exaggeration: C.terrain3d.exaggeration });
            map.on("click", "fire-events-circle", (event) => this.handleFireClick(event));
            this.beginInitialFrameWatch(map);
            resolve();
          } catch (error) {
            reject(error);
          }
        };
        try {
          map.on("style.load", ready);
          map.on("load", ready);
          this._styleInitTimer = setTimeout(() => reject(new Error("STYLE_UNAVAILABLE")), 12000);
        } catch (error) {
          reject(error);
        }
      });
      window.addEventListener("resize", this._resizeHandler);
      map.resize();
    }

    waitForFirstUsableFrame(map) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (this.map !== map || this.firstVisualReady) return;
          const firstUsableRender = this._renderCount > Math.max(this._baseSuccessRender, this._demSuccessRender);
          // MapLibre may keep isStyleLoaded() false while unrelated background tiles stream.
          // A rendered base + DEM content frame is the user-visible readiness contract.
          if (!this._baseSuccessSeen || !this._demSuccessSeen || !firstUsableRender) return;
          this.firstVisualReady = true;
          clearTimeout(this._firstFrameTimer);
          this._firstFrameTimer = null;
          this._firstFrameWait = null;
          resolve();
        };
        this._firstFrameWait = { map, check, reject };
        check();
      });
    }

    cancelFirstFrameWait(error) {
      clearTimeout(this._firstFrameTimer);
      this._firstFrameTimer = null;
      const wait = this._firstFrameWait;
      this._firstFrameWait = null;
      if (wait && error) wait.reject(error);
    }

    replaceBaseRaster(base, id) {
      if (!this.map) return;
      if (this.map.getLayer?.("base-raster")) this.map.removeLayer("base-raster");
      if (this.map.getSource?.("base-raster")) this.map.removeSource("base-raster");
      this.map.addSource("base-raster", this.baseRasterSource(base));
      this.map.addLayer({ id: "base-raster", type: "raster", source: "base-raster" }, "terrain-hillshade");
      this._baseStyleId = id;
    }

    activateBaseFallback() {
      if (!this.map || this._baseFallbackTriggered) return false;
      const fallback = this.baseTiles("osm");
      this._baseFallbackTriggered = true;
      this._baseSuccessSeen = false;
      this._baseErrorCount = 0;
      this.replaceBaseRaster(fallback, this.baseStyleId(fallback, "fallback:osm"));
      return true;
    }

    handleContextLost(event) {
      event?.preventDefault?.();
      if (this.map) this.fail("load");
    }

    handleContextRestored() {
      // A new explicit toggle is safer than attempting to revive a stale MapLibre context.
    }

    show3d() {
      this.container?.classList.remove("hidden", "preparing");
      document.getElementById("map")?.classList.add("terrain2dHidden");
      this.map?.resize();
    }

    disable() {
      if (!this.map && !this.enabled) return;
      clearTimeout(this._styleInitTimer);
      this._styleInitTimer = null;
      this.cancelFirstFrameWait(new Error("TERRAIN_DISABLED"));
      const camera = this.map
        ? { center: this.map.getCenter(), zoom: this.map.getZoom() }
        : null;
      window.removeEventListener("resize", this._resizeHandler);
      this._contextCanvas?.removeEventListener("webglcontextlost", this._contextLostHandler, false);
      this._contextCanvas?.removeEventListener("webglcontextrestored", this._contextRestoredHandler, false);
      this._contextCanvas = null;
      try {
        this.map?.remove();
      } catch (e) {}
      this.map = null;
      this.enabled = false;
      this.firstVisualReady = false;
      this.container?.replaceChildren();
      this.container?.classList.add("hidden");
      this.container?.classList.remove("preparing");
      const leaflet = this.owner.map;
      document.getElementById("map")?.classList.remove("terrain2dHidden");
      leaflet?.invalidateSize(true);
      if (camera?.center && leaflet) {
        leaflet.setView([camera.center.lat, camera.center.lng], this.mapLibreZoom(camera.zoom), { animate: false });
      }
      this.refreshUi("off");
    }

    fail(kind) {
      if (this._failureActive) return;
      this._failureActive = true;
      this.cancelFirstFrameWait(new Error(
        kind === "base" ? "FIRST_FRAME_BASE_FAILED" : kind === "dem" ? "FIRST_FRAME_DEM_FAILED" : "TERRAIN_FAILED",
      ));
      const key = kind === "dem"
        ? "terrain3d.errorDem"
        : kind === "base"
          ? "terrain3d.errorBase"
          : kind === "unavailable"
            ? "terrain3d.errorUnavailable"
            : "terrain3d.errorLoad";
      this.disable();
      A.app?.ui?.toast?.(T(key), "error");
    }

    sync({ camera = false } = {}) {
      if (!this.map || !this.enabled) return;
      if (camera) {
        const next = this.leafletCamera();
        this.map.jumpTo({ center: next.center, zoom: this.mapLibreZoom(next.zoom) });
      }
      this.syncBaseMap();
      this.syncCountryBoundary();
      this.syncGrid();
      this.syncFires();
      this.syncRisk();
      this.syncImagery();
    }

    setSourceData(id, data) {
      this.map?.getSource?.(id)?.setData(data || EMPTY());
    }

    activeGridData(key) {
      const data = this.owner.gridData.get(key);
      if (!data?.features) return EMPTY();
      const layer = this.owner.gridLayers.get(key);
      if (layer && !this.owner.map?.hasLayer(layer)) return EMPTY();
      const country = C.activeCountryCode;
      return {
        type: "FeatureCollection",
        features: data.features.filter((feature) => !feature.properties?.countryCode || feature.properties.countryCode === country),
      };
    }

    syncCountryBoundary() {
      const geometry = C.regionGeometry;
      this.setSourceData("country-boundary", geometry ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { countryCode: C.activeCountryCode }, geometry }] } : EMPTY());
    }

    syncGrid() {
      this.setSourceData("grid-400", this.activeGridData("400"));
      this.setSourceData("grid-154", this.activeGridData("154"));
      this.setSourceData("substations", this.activeGridData("substations"));
      const fire154 = this.owner.getEffectiveGridStyle?.("154") || C.gridSources["154"];
      const grid400 = this.owner.getEffectiveGridStyle?.("400") || C.gridSources["400"];
      this.setPaint("grid-400-line", "line-color", grid400.color);
      this.setPaint("grid-400-line", "line-width", grid400.weight);
      this.setPaint("grid-400-line", "line-opacity", grid400.opacity);
      this.setPaint("grid-154-line", "line-color", fire154.color);
      this.setPaint("grid-154-line", "line-width", fire154.weight);
      this.setPaint("grid-154-line", "line-opacity", fire154.opacity);
    }

    eventFeature(event) {
      const frp = Number(event.maxFrp || 0);
      return {
        type: "Feature",
        id: event.id,
        properties: {
          id: event.id,
          maxFrp: frp,
          count: event.count || 0,
          latestDetectedAt: event.latestDetectedAt || null,
          color: A.Utils.frpColor(frp),
          opacity: A.Utils.ageOpacity(event.latestDetectedAt, new Date()),
          radius: A.Utils.clamp(6 + Math.sqrt(Math.max(0, frp)) * 0.25 + Math.sqrt(event.count || 0), 7, 16),
        },
        geometry: { type: "Point", coordinates: [event.lon, event.lat] },
      };
    }

    syncFires() {
      const events = this.owner.map?.hasLayer(this.owner.fireLayer)
        ? this.owner.fireEventsVisible || []
        : [];
      this.setSourceData("fire-events", { type: "FeatureCollection", features: events.map((event) => this.eventFeature(event)) });
    }

    syncRisk() {
      const features = (this.owner.lastRiskVisible ? this.owner.lastRiskAnalyses || [] : [])
        .filter((analysis) => analysis?.event && Number(analysis.riskScore) >= 20)
        .map((analysis) => ({
          type: "Feature",
          properties: { color: A.Utils.riskColor(analysis.riskBand?.level || "watch"), radius: analysis.riskScore >= 75 ? 9 : 6 },
          geometry: { type: "Point", coordinates: [analysis.event.lon, analysis.event.lat] },
        }));
      this.setSourceData("risk-events", { type: "FeatureCollection", features });
    }

    imageryConfig() {
      const mode = this.owner.satelliteImageryMode;
      const time = this.owner.imageryDisplayedTime;
      if (!mode || mode === "none" || !time) return null;
      const activeLayer = this.owner.satelliteImageryLayer;
      if (mode === "highRes") {
        const cfg = C.viirsTrueColorWmts;
        if (activeLayer?.options?.layer !== cfg.layer) return null;
        return {
          id: `viirs:${time}`,
          tiles: [cfg.url.replace("{layer}", cfg.layer).replace("{time}", time)],
          attribution: cfg.attribution,
          opacity: this.owner.getSatelliteImageryOpacity?.(cfg.defaultOpacity) ?? cfg.defaultOpacity,
        };
      }
      const cfg = mode === "fire" ? C.mtgFireTemperatureWms : C.mtgGeoColourWms;
      if (activeLayer?.options?.layers !== cfg.layer) return null;
      const query = new URLSearchParams({
        SERVICE: "WMS",
        VERSION: cfg.version || "1.3.0",
        REQUEST: "GetMap",
        LAYERS: cfg.layer,
        STYLES: "",
        FORMAT: cfg.format || "image/png",
        TRANSPARENT: "TRUE",
        CRS: "EPSG:3857",
        BBOX: "{bbox-epsg-3857}",
        WIDTH: "256",
        HEIGHT: "256",
        TIME: time,
      });
      return {
        id: `${mode}:${time}`,
        tiles: [`${cfg.url}?${query.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`],
        attribution: cfg.attribution,
        opacity: this.owner.getSatelliteImageryOpacity?.(cfg.defaultOpacity) ?? cfg.defaultOpacity,
      };
    }

    syncImagery() {
      if (!this.map) return;
      const config = this.imageryConfig();
      const sourceId = "operational-imagery";
      const layerId = "operational-imagery-layer";
      const current = this.map.getSource?.(sourceId);
      if (!config) {
        if (this.map.getLayer?.(layerId)) this.map.removeLayer(layerId);
        if (current) this.map.removeSource(sourceId);
        return;
      }
      if (current?.__gridRiskId === config.id) {
        this.setPaint(layerId, "raster-opacity", config.opacity);
        return;
      }
      if (this.map.getLayer?.(layerId)) this.map.removeLayer(layerId);
      if (current) this.map.removeSource(sourceId);
      this.map.addSource(sourceId, { type: "raster", tiles: config.tiles, tileSize: 256, attribution: config.attribution });
      const source = this.map.getSource(sourceId);
      if (source) source.__gridRiskId = config.id;
      this.map.addLayer({ id: layerId, type: "raster", source: sourceId, paint: { "raster-opacity": config.opacity } }, "grid-400-line");
    }

    syncBaseMap() {
      const source = this.map?.getSource?.("base-raster");
      if (!source) return;
      const base = this.baseTiles();
      const id = this.baseStyleId(base);
      // The initial style already owns this source. Do not tear it down during first activation.
      if (this._baseStyleId === id) return;
      // Keep a successful 3D OSM fallback independent from the user's unchanged Leaflet base-map choice.
      if (this._baseFallbackTriggered && id === this._selectedBaseStyleId) return;
      this._baseFallbackTriggered = false;
      this._selectedBaseStyleId = id;
      this.replaceBaseRaster(base, id);
    }

    setPaint(layer, property, value) {
      if (this.map?.getLayer?.(layer)) this.map.setPaintProperty(layer, property, value);
    }

    handleFireClick(event) {
      const id = event?.features?.[0]?.properties?.id;
      const fireEvent = (this.owner.fireEventsVisible || []).find((item) => String(item.id) === String(id));
      if (!fireEvent) return;
      this.owner.onPointClick?.({ lat: fireEvent.lat, lon: fireEvent.lon, fire: fireEvent.representative, fireEvent });
    }
  }

  A.Terrain3DManager = Terrain3DManager;
})(window.AtmoApp);
