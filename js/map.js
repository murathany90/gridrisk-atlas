(function (A) {
  const U = A.Utils,
    C = A.CONFIG,
    I = A.I18n,
    T = (key, params) => I.t(key, params);

  class SmokeCanvasLayer extends L.Layer {
    constructor() {
      super();
      this.data = [];
      this.variable = "pm10_wildfires";
      this.opacity = 0.8;
      this._bound = () => this.redraw();
    }
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "leaflet-smoke-canvas");
      this._canvas.setAttribute("aria-hidden", "true");
      map.getPane("airPane").appendChild(this._canvas);
      map.on("moveend zoomend resize", this._bound);
      this.redraw();
    }
    onRemove(map) {
      map.off("moveend zoomend resize", this._bound);
      this._canvas?.remove();
      this._canvas = null;
      this._map = null;
    }
    setData(data, variable) {
      this.data = (data || []).filter((x) => Number.isFinite(x.value));
      this.variable = variable;
      this.redraw();
    }
    setOpacity(v) {
      this.opacity = U.clamp(Number(v) || 0.8, 0.25, 1);
      if (this._canvas) this._canvas.style.opacity = String(this.opacity);
    }
    redraw() {
      if (!this._map || !this._canvas) return;
      const size = this._map.getSize(),
        topLeft = this._map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      const dpr = window.devicePixelRatio || 1;
      this._canvas.width = Math.max(1, size.x * dpr);
      this._canvas.height = Math.max(1, size.y * dpr);
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      this._canvas.style.opacity = String(this.opacity);
      const ctx = this._canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      if (!this.data.length) return;
      const projected = this.data
        .map((p) => ({
          p,
          pt: this._map.latLngToContainerPoint([p.lat, p.lon]),
        }))
        .filter(
          (x) =>
            x.pt.x > -180 &&
            x.pt.y > -180 &&
            x.pt.x < size.x + 180 &&
            x.pt.y < size.y + 180,
        );
      if (!projected.length) return;
      const n = projected.length,
        area = Math.max(1, size.x * size.y),
        spacing = Math.sqrt(area / Math.max(1, n)),
        radius = U.clamp(spacing * 1.55, 64, 170);
      ctx.globalCompositeOperation = "source-over";
      for (const { p, pt } of projected) {
        const alpha = U.smokeAlpha(this.variable, p.value);
        if (alpha <= 0) continue;
        const [r, g, b] = U.smokeColor(this.variable, p.value),
          gr = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);
        gr.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.9})`);
        gr.addColorStop(0.25, `rgba(${r},${g},${b},${alpha * 0.72})`);
        gr.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.38})`);
        gr.addColorStop(0.82, `rgba(${r},${g},${b},${alpha * 0.12})`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(pt.x - radius, pt.y - radius, radius * 2, radius * 2);
      }
    }
  }

  class HexagonMarker extends L.CircleMarker {
    _updatePath() {
      const r = this._radius,
        p = this._point,
        pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push(L.point(p.x + r * Math.cos(a), p.y + r * Math.sin(a)));
      }
      this._parts = [pts];
      this._renderer._updatePoly(this, true);
    }
  }

  function mtgFmt(iso) {
    return iso ? iso.slice(11, 16) + " UTC" : "—";
  }
  class MtgFrameManager {
    constructor(cfg, handlers) {
      this.cfg = cfg;
      this.on = handlers || {};
      this.slot = (cfg.slotMinutes || 10) * 60 * 1000;
      this.maxBack = cfg.maxBackfillSlots ?? 12;
      this.settleMs = cfg.frameSettleMs ?? 3000;
      this.frameSeq = 0;
      this.requestedFrame = null;
      this.lastUserTime = null;
      this.displayedTime = null;
      this.loadedTileCount = 0;
      this.failedTileCount = 0;
      this.backfillAttempt = 0;
      this._settleT = null;
      this._probeDone = false;
    }
    static roundToSlot(ms, slot) {
      return new Date(Math.floor(ms / slot) * slot);
    }
    latestAllowed() {
      return MtgFrameManager.roundToSlot(Date.now(), this.slot);
    }
    normalize(date) {
      const ms = Number(date instanceof Date ? date.getTime() : date),
        s = MtgFrameManager.roundToSlot(ms, this.slot),
        max = this.latestAllowed();
      return s.getTime() > max.getTime() ? max : s;
    }
    applyUserTime(iso) {
      this.lastUserTime = iso;
      this.backfillAttempt = 0;
      if (iso === this.requestedFrame) return null;
      return this._start(iso);
    }
    applyBackfill(iso) {
      return this._start(iso);
    }
    _start(iso) {
      if (this._settleT) {
        clearTimeout(this._settleT);
        this._settleT = null;
      }
      this.frameSeq++;
      this.requestedFrame = iso;
      this.loadedTileCount = 0;
      this.failedTileCount = 0;
      this._probeDone = false;
      this.on.start?.(iso, this.frameSeq);
      return this.frameSeq;
    }
    tileLoad(seq) {
      if (seq !== this.frameSeq) return;
      this.loadedTileCount++;
      if (this._settleT) {
        clearTimeout(this._settleT);
        this._settleT = null;
      }
      if (this.loadedTileCount === 1) {
        this.displayedTime = this.requestedFrame;
        this.on.ok?.(this.requestedFrame, this.frameSeq);
      }
    }
    tileError(seq) {
      if (seq !== this.frameSeq || this.loadedTileCount > 0) return;
      this.failedTileCount++;
      if (this._settleT) return;
      this._settleT = setTimeout(() => this._settle(), this.settleMs);
    }
    dispose() {
      if (this._settleT) {
        clearTimeout(this._settleT);
        this._settleT = null;
      }
    }
    async _settle() {
      this._settleT = null;
      const seq = this.frameSeq;
      if (this.loadedTileCount > 0 || seq === 0) return;
      if (this.backfillAttempt >= this.maxBack) {
        this.on.exhausted?.(this.requestedFrame, this.backfillAttempt, seq);
        return;
      }
      if (!this._probeDone && this.on.probe) {
        this._probeDone = true;
        const kind = await this.on.probe(this.requestedFrame);
        if (this.frameSeq !== seq || this.loadedTileCount > 0 || this._settleT)
          return;
        if (kind === "invalid") {
          this.on.invalid?.(this.requestedFrame, seq);
          return;
        }
        if (kind === "network") {
          this.on.network?.(this.requestedFrame, seq);
          return;
        }
      }
      this.backfillAttempt++;
      const target = new Date(
        Date.parse(this.requestedFrame) - this.slot,
      ).toISOString();
      this.on.backfill?.(
        this.requestedFrame,
        target,
        this.backfillAttempt,
        seq,
      );
    }
  }

  class MapManager {
    static eligibleMultiSensor(events) {
      return (events || []).filter(
        (ev) =>
          (ev.independentSensorCount || 0) >= 2 &&
          U.insideRegion({ lat: ev.lat, lon: ev.lon }),
      );
    }
    constructor() {
      this.map = null;
      this.renderer = null;
      this.baseLayer = null;
      this.baseKey = null;
      this.fireLayer = null;
      this.fireAll = [];
      this.fireVisible = [];
      this.fireEventsVisible = [];
      this.currentSelectedTime = new Date();
      this.frpHeat = null;
      this.smokeLayer = null;
      this.airData = [];
      this.airVariable = "pm10_wildfires";
      this.windLayer = null;
      this.windData = [];
      this.surfaceWindData = [];
      this.riskLayer = null;
      this.riskAssetLayer = null;
      this.riskEvidenceLayer = null;
      this.lastRiskEvidence = null;
      this.downwindLayer = null;
      this.windVectorLayer = null;
      this.lastWindVector = null;
      this.lastDownwindAnalyses = [];
      this.lastDownwindVisible = false;
      this.lastRiskAnalyses = [];
      this.lastRiskVisible = false;
      this.gridLayers = new Map();
      this.gridData = new Map();
      this._gridViewportTimer = null;
      this.fwiLayer = null;
      this.effisBurntAreaLayer = null;
      this.mtgLayer = null;
      this._mtgFrameMgr = null;
      this._mtgDebounceT = null;
      this.mtgRequestedTime = null;
      this.mtgDisplayedTime = null;
      this.onPointClick = null;
      this.frpThreshold = C.frpThreshold;
      this._renderTimer = null;
      this.footprintLayer = null;
      this.thermalEnvelopeLayer = null;
      this.evolutionLayer = null;
      this._sparkCache = new Map();
      this.slstrLayer = null;
      this.slstrALayer = null;
      this.slstrBLayer = null;
      this.mtgFrpLayer = null;
      this.multiSensorLayer = null;
      this.slstrVisible = false;
      this.slstrAVisible = false;
      this.slstrBVisible = false;
      this.mtgFrpVisible = false;
      this.multiSensorVisible = false;
      this.slstrData = [];
      this.slstrAData = [];
      this.slstrBData = [];
      this.mtgFrpData = [];
      this.multiSensorEvents = [];
    }
    init(onPointClick) {
      this.onPointClick = onPointClick;
      this.map = L.map("map", {
        zoomControl: true,
        minZoom: C.mapMinZoom || 2,
        worldCopyJump: true,
      }).setView(C.defaultCenter, C.defaultZoom);
      this.renderer = L.canvas({ padding: 0.4 });
      this.map.createPane("mtgPane");
      this.map.getPane("mtgPane").style.zIndex = 240;
      this.map.createPane("airPane");
      this.map.getPane("airPane").style.zIndex = 320;
      this.map.createPane("fwiPane");
      this.map.getPane("fwiPane").style.zIndex = 330;
      this.map.createPane("gridPane");
      this.map.getPane("gridPane").style.zIndex = 410;
      this.map.createPane("riskPane");
      this.map.getPane("riskPane").style.zIndex = 445;
      this.map.createPane("firePane");
      this.map.getPane("firePane").style.zIndex = 460;
      this.map.createPane("verificationPane");
      this.map.getPane("verificationPane").style.zIndex = 470;
      this.map.createPane("windPane");
      this.map.getPane("windPane").style.zIndex = 480;
      this.setBaseMap(localStorage.getItem("baseMap") || "satellite");
      this.fireLayer = L.layerGroup([], { pane: "firePane" }).addTo(this.map);
      this.smokeLayer = new SmokeCanvasLayer().addTo(this.map);
      this.windLayer = L.layerGroup([], { pane: "windPane" });
      this.riskLayer = L.layerGroup([], { pane: "riskPane" }).addTo(this.map);
      this.riskAssetLayer = L.layerGroup([], { pane: "riskPane" }).addTo(
        this.map,
      );
      this.riskEvidenceLayer = L.layerGroup([], { pane: "riskPane" }).addTo(
        this.map,
      );
      this.downwindLayer = L.layerGroup([], { pane: "riskPane" });
      this.windVectorLayer = L.layerGroup([], { pane: "windPane" }).addTo(
        this.map,
      );
      this.borderLayer = L.polygon(C.regionPolygon, {
        pane: "gridPane",
        color: "#60a5fa",
        weight: 1.5,
        fill: false,
        dashArray: "4 4",
        opacity: 0.55,
        interactive: false,
      }).addTo(this.map);
      this.footprintLayer = L.layerGroup([], { pane: "riskPane" });
      this.thermalEnvelopeLayer = L.layerGroup([], { pane: "firePane" });
      this.evolutionLayer = L.layerGroup([], { pane: "riskPane" });
      this.slstrLayer = L.layerGroup([], { pane: "firePane" });
      this.slstrALayer = L.layerGroup([], { pane: "firePane" });
      this.slstrBLayer = L.layerGroup([], { pane: "firePane" });
      this.mtgFrpLayer = L.layerGroup([], { pane: "firePane" });
      this.multiSensorLayer = L.layerGroup([], { pane: "verificationPane" });
      this.map.on("click", (e) => {
        const p = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (U.insideRegion(p)) this.onPointClick?.(p);
        else A.Events.emit("outsideDataRegion", p);
      });
      this.map.on("zoomend moveend", () => {
        if (!this._renderTimer) {
          const t = this.currentSelectedTime;
          this._renderTimer = setTimeout(() => {
            this._renderTimer = null;
            this.renderFires(t);
          }, 60);
        }
        if (!this._gridViewportTimer)
          this._gridViewportTimer = setTimeout(() => {
            this._gridViewportTimer = null;
            this.refreshSubstationLayer();
          }, 80);
      });
      setTimeout(() => this.map.invalidateSize(true), 60);
      return this.map;
    }
    setBaseMap(key, mode = "auto") {
      const cfg = C.baseMaps[key] || C.baseMaps.satellite;
      if (this.baseLayer) this.map?.removeLayer(this.baseLayer);
      this.baseKey = key in C.baseMaps ? key : "satellite";
      const localServer =
          location.protocol !== "file:" &&
          ["127.0.0.1", "localhost"].includes(location.hostname),
        useProxy = mode === "proxy" || (mode === "auto" && localServer),
        url = useProxy
          ? `/api/tiles/${encodeURIComponent(this.baseKey)}/{z}/{x}/{y}`
          : cfg.url;
      this.baseLayer = L.tileLayer(url, {
        maxZoom: cfg.maxZoom || 19,
        subdomains: cfg.subdomains || "abc",
        attribution: cfg.attribution,
        updateWhenIdle: true,
        keepBuffer: 3,
      });
      let loaded = false,
        errors = 0,
        fallbackDone = false;
      this.baseLayer.on("tileload", () => {
        loaded = true;
        A.Events.emit("basemapStatus", {
          state: "ok",
          key: this.baseKey,
          mode: useProxy ? "proxy" : "direct",
        });
      });
      this.baseLayer.on("tileerror", () => {
        errors++;
        if (loaded || fallbackDone || errors < 5) return;
        fallbackDone = true;
        if (useProxy) {
          A.Events.emit("basemapError", {
            key: this.baseKey,
            note: T("map.basemapProxyFail", { label: cfg.label }),
          });
          setTimeout(() => this.setBaseMap(this.baseKey, "direct"), 0);
          return;
        }
        if (this.baseKey !== "osm") {
          A.Events.emit("basemapError", {
            key: this.baseKey,
            note: T("map.basemapDirectFail", { label: cfg.label }),
          });
          setTimeout(() => this.setBaseMap("osm", "direct"), 0);
          return;
        }
        A.Events.emit("basemapError", {
          key: this.baseKey,
          note: T("map.basemapUnavailable"),
        });
      });
      this.baseLayer.addTo(this.map);
      this.baseLayer.bringToBack();
      localStorage.setItem("baseMap", this.baseKey);
      A.Events.emit("basemap", {
        key: this.baseKey,
        label: cfg.label,
        mode: useProxy ? "server-proxy" : "direct",
      });
    }
    bounds() {
      return this.map.getBounds();
    }
    zoom() {
      return this.map.getZoom();
    }
    center() {
      const c = this.map.getCenter();
      return { lat: c.lat, lon: c.lng };
    }
    setView(lat, lon, zoom = 9) {
      const la = Number(lat),
        lo = Number(lon);
      if (Number.isFinite(la) && Number.isFinite(lo))
        this.map.setView([U.clamp(la, -85, 85), lo], zoom);
    }
    setCountryBoundary(boundary, country, fit = true) {
      if (this.borderLayer) this.map.removeLayer(this.borderLayer);
      this.borderLayer = L.geoJSON(boundary, {
        pane: "gridPane",
        style: {
          color: "#60a5fa",
          weight: 1.5,
          fill: false,
          dashArray: "4 4",
          opacity: 0.7,
          interactive: false,
        },
      }).addTo(this.map);
      if (fit) {
        const bounds = this.borderLayer.getBounds();
        if (bounds.isValid())
          this.map.fitBounds(bounds, {
            padding: [12, 12],
            maxZoom: country.zoom || 6,
            animate: false,
          });
      }
      this.map.invalidateSize();
    }
    resetCountry() {
      this.fireAll = [];
      this.fireVisible = [];
      this.fireEventsVisible = [];
      this.fireLayer.clearLayers();
      if (this.frpHeat) {
        this.map.removeLayer(this.frpHeat);
        this.frpHeat = null;
      }
      if (this.borderLayer) {
        this.map.removeLayer(this.borderLayer);
        this.borderLayer = null;
      }
      this.clearSmoke();
      this.windData = [];
      this.surfaceWindData = [];
      this.windLayer.clearLayers();
      this.riskLayer.clearLayers();
      this.riskAssetLayer.clearLayers();
      this.riskEvidenceLayer.clearLayers();
      this.lastRiskEvidence = null;
      this.downwindLayer.clearLayers();
      this.windVectorLayer.clearLayers();
      this.footprintLayer.clearLayers();
      this.thermalEnvelopeLayer.clearLayers();
      this.evolutionLayer.clearLayers();
      this.slstrLayer.clearLayers();
      this.slstrALayer.clearLayers();
      this.slstrBLayer.clearLayers();
      this.mtgFrpLayer.clearLayers();
      this.multiSensorLayer.clearLayers();
      this.slstrData = [];
      this.slstrAData = [];
      this.slstrBData = [];
      this.mtgFrpData = [];
      this.multiSensorEvents = [];
      for (const layer of this.gridLayers.values())
        if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
      this.gridLayers.clear();
      this.gridData.clear();
      document
        .querySelectorAll("#legendStack [data-legend]")
        .forEach((x) => x.remove());
    }
    setFires(data, selectedTime) {
      this.fireAll = (data || []).filter(U.insideRegion.bind(U));
      this.renderFires(selectedTime);
    }
    renderFires(selectedTime) {
      this.currentSelectedTime = new Date(selectedTime);
      this._sparkCache.clear();
      this.fireLayer.clearLayers();
      if (this.frpHeat) {
        this.map.removeLayer(this.frpHeat);
        this.frpHeat = null;
      }
      const end = Math.min(
          this.currentSelectedTime.getTime(),
          Date.now() + 15 * 60e3,
        ),
        start = end - 24 * 3600e3;
      this.fireVisible = this.fireAll.filter((f) => {
        const t = Date.parse(f.detectedAt);
        return t >= start && t <= end;
      });
      const allEvents = U.clusterFires(this.fireVisible);
      this.fireEventsVisible = allEvents.filter(
        (ev) => ev.maxFrp >= this.frpThreshold,
      );
      const slider = document.getElementById("timeSlider"),
        reference = U.timeReference(
          this.currentSelectedTime,
          slider ? Number(slider.value) : 0,
        );
      if (this.zoom() < 9) {
        if (!this._fireDetailBound) {
          this._fireDetailBound = true;
          document.addEventListener(
            "click",
            (e) => {
              const a = e.target?.closest?.("a.fire-event-detail");
              if (!a) return;
              e.preventDefault();
              this.fireLayer.eachLayer((l) => l.closePopup?.());
              const ev2 = this.fireEventsVisible.find(
                (x) => x.id === a.dataset.id,
              );
              this.onPointClick?.({
                lat: Number(a.dataset.lat),
                lon: Number(a.dataset.lon),
                fire: ev2?.representative,
                fireEvent: ev2,
              });
            },
            true,
          );
        }
        for (const ev of this.fireEventsVisible) {
          const count = ev.count,
            radius = U.clamp(
              7 +
                Math.sqrt(count) * 2.2 +
                Math.sqrt(Math.max(0, ev.maxFrp)) * 0.35,
              8,
              24,
            ),
            opacity = U.ageOpacity(ev.latestDetectedAt, new Date(end)),
            m = new HexagonMarker([ev.lat, ev.lon], {
              pane: "firePane",
              renderer: this.renderer,
              radius,
              color: "#fff",
              weight: 1.2,
              opacity,
              fillColor: U.frpColor(ev.maxFrp),
              fillOpacity: opacity * 0.92,
            });
          const tooltipOptions = {
            className: "fire-event-tooltip",
            direction: "top",
            offset: L.point(0, -8),
            opacity: 0.97,
            sticky: false,
            permanent: false,
            interactive: false,
          };
          if (window.matchMedia?.("(pointer: coarse)").matches) {
            m.bindPopup(
              this.firesEventTooltip(
                ev,
                U.areaHistory(this.fireAll, ev, C.NEARBY_FIRMS_RADIUS_KM),
                reference,
                { withDetails: true },
              ),
              { className: "fire-event-popup", maxWidth: 236 },
            );
          } else {
            m.bindTooltip(
              this.firesEventTooltip(
                ev,
                U.areaHistory(this.fireAll, ev, C.NEARBY_FIRMS_RADIUS_KM),
                reference,
              ),
              tooltipOptions,
            );
          }
          if (!window.matchMedia?.("(pointer: coarse)").matches)
            m.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              this.onPointClick?.({
                lat: ev.lat,
                lon: ev.lon,
                fire: ev.representative,
                fireEvent: ev,
              });
            });
          m.addTo(this.fireLayer);
        }
      } else {
        const bounds = this.map.getBounds();
        const inView = this.fireVisible
          .filter((f) => f.frp == null || f.frp >= this.frpThreshold)
          .filter((f) => bounds.contains([f.lat, f.lon]))
          .sort((a, b) => Math.abs(b.frp || 0) - Math.abs(a.frp || 0))
          .slice(0, 5000);
        for (const f of inView) {
          const radius = U.clamp(
              4 + Math.sqrt(Math.max(0, f.frp || 0)) * 1.05,
              4,
              17,
            ),
            opacity = U.ageOpacity(f.detectedAt, new Date(end)),
            m = new HexagonMarker([f.lat, f.lon], {
              pane: "firePane",
              renderer: this.renderer,
              radius,
              color: "#fff",
              weight: 1,
              opacity,
              fillColor: U.frpColor(f.frp),
              fillOpacity: opacity * 0.9,
            });
          m.bindTooltip(
            this.firesDetectionTooltip(
              f,
              U.areaHistory(this.fireAll, f, C.NEARBY_FIRMS_RADIUS_KM),
              reference,
            ),
          );
          m.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            this.onPointClick?.({ lat: f.lat, lon: f.lon, fire: f });
          });
          m.addTo(this.fireLayer);
        }
      }
      A.Events.emit("firesRendered", {
        detections: this.fireVisible.length,
        events: this.fireEventsVisible.length,
        eventsTotal: allEvents.length,
      });
    }
    toggleFires(show) {
      if (show) {
        if (!this.map.hasLayer(this.fireLayer)) this.fireLayer.addTo(this.map);
      } else this.map.removeLayer(this.fireLayer);
    }
    setSlstrSource(sourceId, data, selectedTime) {
      const isA = sourceId === "sentinel3a-slstr",
        layer = isA ? this.slstrALayer : this.slstrBLayer,
        visKey = isA ? "slstrAVisible" : "slstrBVisible",
        cacheKey = isA ? "slstrAData" : "slstrBData";
      this[cacheKey] = (data || []).filter(U.insideRegion.bind(U));
      layer.clearLayers();
      const end = new Date(selectedTime || this.currentSelectedTime),
        start = end.getTime() - 24 * 3600e3;
      const visible = this[cacheKey].filter((f) => {
        const t = Date.parse(f.detectedAt);
        if (!Number.isFinite(t) || t < start || t > end.getTime()) return false;
        if (this.frpThreshold > 0 && (!Number.isFinite(f.frp) || f.frp < this.frpThreshold)) return false;
        return true;
      });
      for (const f of visible) {
        const radius = U.clamp(4 + Math.sqrt(Math.max(0, f.frp || 0)) * 0.8, 4, 14),
          opacity = U.ageOpacity(f.detectedAt, end),
          m = new HexagonMarker([f.lat, f.lon], {
            pane: "firePane",
            renderer: this.renderer,
            radius,
            color: isA ? "#f59e0b" : "#ec4899",
            weight: 1,
            opacity,
            fillColor: U.frpColor(f.frp),
            fillOpacity: opacity * 0.85,
          });
        m.bindTooltip(
          this.slstrDetectionTooltip(f, isA ? "S3A" : "S3B"),
          { className: "fire-event-tooltip", direction: "top", offset: L.point(0, -6), opacity: 0.97 },
        );
        m.bindPopup(
          this.slstrDetectionPopup(f, isA ? "Sentinel-3A" : "Sentinel-3B"),
          { className: "fire-event-popup", maxWidth: 280 },
        );
        m.addTo(layer);
      }
      if (this[visKey] && !this.map.hasLayer(layer)) layer.addTo(this.map);
      else if (!this[visKey]) this.map.removeLayer(layer);
      A.Events.emit("slstrRendered", { sourceId, count: visible.length });
      return visible.length;
    }
    setSlstr(data, selectedTime) {
      this.slstrData = (data || []).filter(U.insideRegion.bind(U));
      if (this.slstrVisible && !this.map.hasLayer(this.slstrLayer))
        this.slstrLayer.addTo(this.map);
      else if (!this.slstrVisible) this.map.removeLayer(this.slstrLayer);
    }
    setMtgFrp(data, selectedTime) {
      this.mtgFrpData = (data || []).filter(U.insideRegion.bind(U));
      this.mtgFrpLayer.clearLayers();
      const end = new Date(selectedTime || this.currentSelectedTime),
        start = end.getTime() - 24 * 3600e3;
      for (const f of this.mtgFrpData) {
        const t = Date.parse(f.detectedAt);
        if (!Number.isFinite(t) || t < start || t > end.getTime()) continue;
        if (this.frpThreshold > 0 && (!Number.isFinite(f.frp) || f.frp < this.frpThreshold)) continue;
        const radius = U.clamp(4 + Math.sqrt(Math.max(0, f.frp || 0)) * 0.7, 4, 13),
          opacity = U.ageOpacity(f.detectedAt, end),
          m = new L.CircleMarker([f.lat, f.lon], {
            pane: "firePane",
            renderer: this.renderer,
            radius,
            color: "#a78bfa",
            weight: 1,
            opacity,
            fillColor: U.frpColor(f.frp),
            fillOpacity: opacity * 0.8,
          });
        m.bindTooltip(
          this.mtgDetectionTooltip(f),
          { className: "fire-event-tooltip", direction: "top", offset: L.point(0, -6), opacity: 0.97 },
        );
        m.bindPopup(
          this.mtgDetectionPopup(f),
          { className: "fire-event-popup", maxWidth: 280 },
        );
        m.addTo(this.mtgFrpLayer);
      }
      if (this.mtgFrpVisible && !this.map.hasLayer(this.mtgFrpLayer))
        this.mtgFrpLayer.addTo(this.map);
      else if (!this.mtgFrpVisible) this.map.removeLayer(this.mtgFrpLayer);
    }
    setMultiSensor(events, selectedTime) {
      this.multiSensorEvents = this.constructor.eligibleMultiSensor(events);
      this.multiSensorLayer.clearLayers();
      for (const ev of this.multiSensorEvents) {
        if (this.frpThreshold > 0 && (!Number.isFinite(ev.maxFrpMw) || ev.maxFrpMw < this.frpThreshold)) continue;
        const level = ev.confirmationLevel || 1;
        const radius = U.clamp(6 + ev.observationCount * 2, 8, 26);
        const color = level >= 3 ? "#22c55e" : "#facc15";
        const weight = level >= 3 ? 3 : 1;
        const m = new L.CircleMarker([ev.lat, ev.lon], {
          pane: "verificationPane",
          renderer: this.renderer,
          radius,
          color: color,
          weight: weight,
          fillColor: color,
          fillOpacity: 0.15,
          opacity: 0.95,
        });
        m.bindTooltip(this.multiSensorTooltip(ev), {
          className: "fire-event-tooltip",
          direction: "top",
          offset: L.point(0, -8),
          opacity: 0.97,
        });
        m.addTo(this.multiSensorLayer);
      }
      if (this.multiSensorVisible && !this.map.hasLayer(this.multiSensorLayer))
        this.multiSensorLayer.addTo(this.map);
      else if (!this.multiSensorVisible)
        this.map.removeLayer(this.multiSensorLayer);
    }
    multiSensorTooltip(ev) {
      const sourceLabels = {
        "nasa-firms": "FIRMS",
        "sentinel3a-slstr": "S3A",
        "sentinel3b-slstr": "S3B",
        "mtg-fci-frp": "MTG",
        "msg-seviri-frp": "MSG",
      };
      const perSource = Object.entries(ev.maxFrpBySource || {})
        .map(
          ([s, v]) =>
            `${sourceLabels[s] || s} ${U.round(v, 1)} MW`,
        );
      const platforms = (ev.supportingPlatforms || []).join(", ");
      const frpLine = Number.isFinite(ev.maxFrpMw)
        ? `<small>${T("map.multiSensorMaxFrp", { frp: U.round(ev.maxFrpMw, 1) })}${perSource.length ? ` · ${perSource.join(" · ")}` : ""}</small>`
        : "";
      const familiesLine = ev.sensorFamilies && ev.sensorFamilies.length ? `<br><small>${T("map.multiSensorFamilies", { families: ev.sensorFamilies.join(", ") })}</small>` : "";
      const latestTime = ev.latestDetectedAt ? U.formatLocal(new Date(ev.latestDetectedAt)) : "—";
      return `<strong>${T("map.multiSensorLabel")}</strong><br>${T("map.multiSensorSensorFamilies", { count: ev.independentSensorCount || 1 })} · ${T("map.multiSensorCount", { count: ev.observationCount || 0 })}<br><small>${T("map.multiSensorLatest", { time: latestTime })}</small>${familiesLine}${frpLine ? "<br>" + frpLine : ""}`;
    }
    toggleSentinelSlstr(show) {
      this.slstrVisible = !!show;
      if (this.slstrVisible && !this.map.hasLayer(this.slstrLayer))
        this.slstrLayer.addTo(this.map);
      else if (!this.slstrVisible) this.map.removeLayer(this.slstrLayer);
      if (this.slstrVisible) {
        this.slstrALayer.addTo(this.map);
        this.slstrBLayer.addTo(this.map);
      } else {
        this.map.removeLayer(this.slstrALayer);
        this.map.removeLayer(this.slstrBLayer);
      }
    }
    toggleSentinelSlstrSource(sourceId, show) {
      const isA = sourceId === "sentinel3a-slstr",
        layer = isA ? this.slstrALayer : this.slstrBLayer,
        key = isA ? "slstrAVisible" : "slstrBVisible";
      this[key] = !!show;
      if (this[key] && !this.map.hasLayer(layer)) layer.addTo(this.map);
      else if (!this[key]) this.map.removeLayer(layer);
    }
    toggleMtgFrp(show) {
      this.mtgFrpVisible = !!show;
      if (this.mtgFrpVisible && !this.map.hasLayer(this.mtgFrpLayer))
        this.mtgFrpLayer.addTo(this.map);
      else if (!this.mtgFrpVisible) this.map.removeLayer(this.mtgFrpLayer);
    }
    toggleMultiSensor(show) {
      this.multiSensorVisible = !!show;
      if (this.multiSensorVisible && !this.map.hasLayer(this.multiSensorLayer)) {
        this.multiSensorLayer.addTo(this.map);
        this.makeLegend("multiSensor", T("legend.multiSensor"), `<div><span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(250,204,21,1);background:rgba(250,204,21,0.15);margin-right:4px;"></span><small>${T("legend.twoSensor")}</small></div><div style="margin-top:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:3px solid rgba(34,197,94,1);background:rgba(34,197,94,0.15);margin-right:4px;box-sizing:border-box;"></span><small>${T("legend.threePlusSensor")}</small></div>`);
      } else if (!this.multiSensorVisible) {
        this.map.removeLayer(this.multiSensorLayer);
        document.querySelector('[data-legend="multiSensor"]')?.remove();
      }
    }
    slstrDetectionTooltip(f, satellite) {
      const frpStr = Number.isFinite(f.frp) ? `${U.round(f.frp, 1)} MW` : "—";
      return `<strong>${satellite} SLSTR · ${frpStr}</strong><br><small>${U.formatTrShortDateTime(new Date(f.detectedAt))}</small>`;
    }
    slstrDetectionPopup(f, satellite) {
      const rows = [];
      rows.push(`<strong>${satellite} · SLSTR</strong>`);
      if (Number.isFinite(f.frp)) rows.push(`<tr><td>${T("map.popup.frp")}</td><td>${U.round(f.frp, 1)} MW</td></tr>`);
      if (Number.isFinite(f.frpUncertaintyMw)) rows.push(`<tr><td>${T("map.popup.frpErr")}</td><td>±${U.round(f.frpUncertaintyMw, 1)} MW</td></tr>`);
      if (f.confidenceRaw != null && Number.isFinite(Number(f.confidenceRaw))) rows.push(`<tr><td>${T("map.popup.confidence")}</td><td>${U.round(Number(f.confidenceRaw), 1)}%</td></tr>`);
      if (Number.isFinite(f.brightnessTemperatureK)) rows.push(`<tr><td>${T("map.popup.bt")}</td><td>${U.round(f.brightnessTemperatureK, 1)} K</td></tr>`);
      if (f.detectedAt) rows.push(`<tr><td>${T("map.popup.time")}</td><td>${U.formatTrShortDateTime(new Date(f.detectedAt))}</td></tr>`);
      if (f.satellite) rows.push(`<tr><td>${T("map.popup.satellite")}</td><td>${f.satellite}</td></tr>`);
      if (f.dayNight) rows.push(`<tr><td>${T("map.popup.dayNight")}</td><td>${f.dayNight === "night" ? T("map.popup.night") : T("map.popup.day")}</td></tr>`);
      if (Number.isFinite(f.scan) && Number.isFinite(f.track)) rows.push(`<tr><td>${T("map.popup.pixelSize")}</td><td>${U.round(f.scan, 2)} × ${U.round(f.track, 2)} km</td></tr>`);
      if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) rows.push(`<tr><td>${T("map.popup.location")}</td><td>${U.round(f.lat, 4)}, ${U.round(f.lon, 4)}</td></tr>`);
      const header = rows.shift();
      return `${header}<table class="popup-meta">${rows.join("")}</table>`;
    }
    mtgDetectionTooltip(f) {
      const frpStr = Number.isFinite(f.frp) ? `${U.round(f.frp, 1)} MW` : "—";
      return `<strong>${T("map.mtgFrpLabel")} · ${frpStr}</strong><br><small>${U.formatTrShortDateTime(new Date(f.detectedAt))}</small>`;
    }
    mtgDetectionPopup(f) {
      const rows = [];
      rows.push(`<strong>MTG-I · FCI FRP</strong>`);
      if (Number.isFinite(f.frp)) rows.push(`<tr><td>${T("map.popup.frp")}</td><td>${U.round(f.frp, 1)} MW</td></tr>`);
      if (Number.isFinite(f.frpUncertaintyMw)) rows.push(`<tr><td>${T("map.popup.frpErr")}</td><td>±${U.round(f.frpUncertaintyMw, 1)} MW</td></tr>`);
      if (f.confidenceRaw != null && Number.isFinite(Number(f.confidenceRaw))) rows.push(`<tr><td>${T("map.popup.confidence")}</td><td>${U.round(Number(f.confidenceRaw), 0)}%</td></tr>`);
      if (Number.isFinite(f.brightTi4K)) rows.push(`<tr><td>${T("map.popup.btMir")}</td><td>${U.round(f.brightTi4K, 1)} K</td></tr>`);
      const btTir = f.BT_tir_k != null ? Number(f.BT_tir_k) : null;
      if (Number.isFinite(btTir)) rows.push(`<tr><td>${T("map.popup.btTir")}</td><td>${U.round(btTir, 1)} K</td></tr>`);
      if (f.detectedAt) rows.push(`<tr><td>${T("map.popup.time")}</td><td>${U.formatTrShortDateTime(new Date(f.detectedAt))}</td></tr>`);
      if (f.dayNight) rows.push(`<tr><td>${T("map.popup.dayNight")}</td><td>${f.dayNight === "night" ? T("map.popup.night") : T("map.popup.day")}</td></tr>`);
      if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) rows.push(`<tr><td>${T("map.popup.location")}</td><td>${U.round(f.lat, 4)}, ${U.round(f.lon, 4)}</td></tr>`);
      rows.push(`<tr><td>${T("map.popup.source")}</td><td>EUMETSAT</td></tr>`);
      const header = rows.shift();
      return `${header}<table class="popup-meta">${rows.join("")}</table>`;
    }
    toggleHeat(show) {
      if (!show) {
        if (this.frpHeat) this.map.removeLayer(this.frpHeat);
        return;
      }
      const candidates = this.fireVisible.filter(
        (f) =>
          U.insideRegion(f) &&
          Number.isFinite(f.frp) &&
          f.frp >= this.frpThreshold,
      );
      const vals = candidates
        .map((f) => f.frp)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const p95Idx = Math.floor(vals.length * 0.95),
        p95 = vals.length ? Math.max(1, vals[p95Idx]) : 1;
      const pts = candidates.map((f) => [
        f.lat,
        f.lon,
        U.clamp(Math.log1p(f.frp) / Math.log1p(p95), 0, 1),
      ]);
      if (this.frpHeat) this.map.removeLayer(this.frpHeat);
      this.frpHeat = L.heatLayer(pts, {
        radius: 24,
        blur: 20,
        maxZoom: 11,
        max: 1,
        pane: "riskPane",
      }).addTo(this.map);
    }
    setSmoke(data, variable) {
      this.airData = data || [];
      this.airVariable = variable;
      this.smokeLayer.setData(this.airData, variable);
      this.updateSmokeLegend();
    }
    clearSmoke() {
      this.airData = [];
      this.smokeLayer.setData([], "pm10_wildfires");
      document.querySelector('[data-legend="smoke"]')?.remove();
    }
    makeLegend(id, title, body) {
      const host = document.getElementById("legendStack");
      host.querySelector(`[data-legend="${id}"]`)?.remove();
      const d = document.createElement("div");
      d.className = "legend";
      d.dataset.legend = id;
      d.innerHTML = `<div class="legendHeader"><div class="legendTitle">${title}</div><button class="legendClose" title="${T("map.legendClose")}" aria-label="${T("map.legendClose")}">×</button></div><div class="legendBody">${body}</div>`;
      d.querySelector(".legendClose").addEventListener("click", () =>
        d.remove(),
      );
      host.appendChild(d);
      return d;
    }
    updateSmokeLegend() {
      const meta = C.smokeVariables.pm10_wildfires,
        values = [0, 1, 3, 8, 15, 30],
        colors = values.map((v) => {
          const [r, g, b] = U.smokeColor("pm10_wildfires", v);
          return `rgb(${r},${g},${b})`;
        });
      this.makeLegend(
        "smoke",
        `${T("layers.smoke")} · ${meta.unit}`,
        `<div class="gradient" style="background:linear-gradient(90deg,${colors.join(",")})"></div><div class="smokeLegendBands"><span>${T("map.low")}<br><b>0–3</b></span><span>${T("map.medium")}<br><b>3–15</b></span><span>${T("map.high")}<br><b>15+</b></span></div><div class="sourceNote">${T("map.smokeNote", { source: meta.source, resolution: meta.resolution })}<br><strong>${T("map.smokeCaution")}</strong></div>`,
      );
    }
    setWind(data, level) {
      this.windData = data || [];
      this.windLayer.clearLayers();
      const valid = this.windData
          .filter(
            (p) => Number.isFinite(p.speed) && Number.isFinite(p.direction),
          )
          .sort((a, b) => a.lat - b.lat || a.lon - b.lon),
        samplingStep = Math.max(1, Math.ceil(valid.length / 12)),
        visible = valid.filter((_, i) => i % samplingStep === 0).slice(0, 12);
      for (const p of visible) {
        const icon = L.divIcon({
          className: "",
          html: `<div class="windArrow" style="transform:rotate(${p.direction}deg)">↑</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const m = L.marker([p.lat, p.lon], {
          pane: "windPane",
          icon,
          interactive: true,
        });
        m.bindTooltip(
          `${T(C.windLevels[level]?.labelKey) || level}<br>${I.formatNumber(U.round(p.speed, 1))} km/h · ${Math.round(p.direction)}° ${U.cardinal(p.direction)}<br>${p.validAt ? U.formatLocal(new Date(p.validAt)) : "—"}`,
        );
        m.addTo(this.windLayer);
      }
    }
    toggleWind(show) {
      if (show) {
        if (!this.map.hasLayer(this.windLayer)) this.windLayer.addTo(this.map);
      } else if (this.map.hasLayer(this.windLayer))
        this.map.removeLayer(this.windLayer);
    }
    drawWindVector(point, direction, speed, level = "10m", validAt = null) {
      this.windVectorLayer.clearLayers();
      if (!Number.isFinite(direction) || !Number.isFinite(speed)) {
        this.lastWindVector = null;
        return;
      }
      this.lastWindVector = { point, direction, speed, level, validAt };
      const downwind = (direction + 180) % 360,
        end = U.destination(point, downwind, U.clamp(speed * 0.7, 12, 45)),
        tooltip = `${T("map.windDirection", { direction: Math.round(downwind), cardinal: U.cardinal(downwind) })}<br>${T("map.speed", { speed: I.formatNumber(U.round(speed, 1)) })}<br>${T("map.modelTime", { time: validAt ? U.formatLocal(new Date(validAt)) : "—" })}`;
      L.polyline(
        [
          [point.lat, point.lon],
          [end.lat, end.lon],
        ],
        {
          pane: "windPane",
          color: "#6dd5fa",
          weight: 3,
          dashArray: "8 6",
          opacity: 0.9,
        },
      )
        .addTo(this.windVectorLayer)
        .bindTooltip(tooltip);
      const icon = L.divIcon({
        className: "windDirectionArrowWrap",
        html: `<span class="windDirectionArrow" style="transform:rotate(${downwind}deg)">↑</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([end.lat, end.lon], {
        pane: "windPane",
        icon,
        interactive: false,
        keyboard: false,
      }).addTo(this.windVectorLayer);
    }
    clearWindVector() {
      this.windVectorLayer.clearLayers();
      this.lastWindVector = null;
    }
    setDownwindCorridors(analyses, show = true) {
      this.lastDownwindAnalyses = analyses || [];
      this.lastDownwindVisible = show;
      this.downwindLayer.clearLayers();
      if (this.map.hasLayer(this.downwindLayer))
        this.map.removeLayer(this.downwindLayer);
      document.querySelector('[data-legend="downwind"]')?.remove();
      if (!show) return;
      let count = 0;
      for (const a of analyses || []) {
        if (
          count >= C.downwind.maxCorridors ||
          !a.wind ||
          a.riskScore < 35 ||
          !Number.isFinite(a.downwindDirection) ||
          !U.insideRegion({ lat: a.event.lat, lon: a.event.lon })
        )
          continue;
        const center = { lat: a.event.lat, lon: a.event.lon },
          pts = [[center.lat, center.lon]],
          steps = 10,
          maxKm = a.corridorDistanceKm || C.downwind.maxDistanceKm;
        for (let i = 0; i <= steps; i++) {
          const bearing =
              a.downwindDirection -
              C.downwind.halfAngleDeg +
              (2 * C.downwind.halfAngleDeg * i) / steps,
            p = U.destination(center, bearing, maxKm);
          pts.push([p.lat, p.lon]);
        }
        pts.push([center.lat, center.lon]);
        const c = U.riskColor(a.riskBand.level),
          dw = a.downwindAssets || { lines: [], substations: [] };
        const poly = L.polygon(pts, {
          pane: "riskPane",
          color: c,
          weight: 1.2,
          opacity: 0.58,
          fillColor: c,
          fillOpacity: 0.1,
          interactive: true,
        });
        poly.bindTooltip(
          `${T("map.corridorTooltip", { distance: maxKm, min: C.downwind.minDistanceKm, max: C.downwind.maxDistanceKm })}<br>${I.formatNumber(U.round(a.corridorWindSpeedKmh ?? a.wind.speed, 1))} km/h · ${T("map.transportDirection", { direction: Math.round(a.downwindDirection) })} · ${T("analysis.maxFrp")} ${I.formatNumber(U.round(a.event.maxFrp, 0))} MW<br>${T(a.corridorWindSource === "fallback" ? "map.windFallback" : "map.surfaceWind")} · <strong>${T("map.inCorridor", { lines: I.formatNumber(dw.lines.length), substations: I.formatNumber(dw.substations.length) })}</strong><br><small>${T("map.screening")}</small>`,
        );
        poly.addTo(this.downwindLayer);
        for (const x of dw.lines.slice(0, 4))
          L.polyline(
            [
              [x.feature.a.lat, x.feature.a.lon],
              [x.feature.b.lat, x.feature.b.lon],
            ],
            {
              pane: "riskPane",
              color: "#7be6ff",
              weight: 4,
              opacity: 0.78,
              dashArray: "5 4",
              interactive: false,
            },
          ).addTo(this.downwindLayer);
        count++;
      }
      if (count) {
        this.downwindLayer.addTo(this.map);
        this.makeLegend(
          "downwind",
          T("map.corridorTitle", {
            min: C.downwind.minDistanceKm,
            max: C.downwind.maxDistanceKm,
          }),
          `<div class="legendLine"><i style="background:#7be6ff"></i><span>${T("map.corridorAsset")}</span></div><div class="sourceNote">${T("map.corridorNote", { min: C.downwind.minDistanceKm, max: C.downwind.maxDistanceKm, angle: C.downwind.halfAngleDeg })}</div>`,
        );
      }
    }
    toggleFwi(show, date) {
      if (!show) {
        if (this.fwiLayer) this.map.removeLayer(this.fwiLayer);
        document.querySelector('[data-legend="fwi"]')?.remove();
        return;
      }
      if (this.fwiLayer) this.map.removeLayer(this.fwiLayer);
      this.fwiLayer = L.tileLayer.wms(C.effisWms, {
        layers: C.effisFwiLayer,
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        time: U.dateOnlyUtc(date),
        opacity: 0.43,
        pane: "fwiPane",
        attribution: "EFFIS / Copernicus",
      });
      let loaded = false;
      this.fwiLayer.on("tileload", () => {
        if (!loaded) {
          loaded = true;
          A.Events.emit("service", {
            id: "effis",
            state: "ok",
            count: null,
            note: `WMS ${C.effisFwiLayer} · TIME=${U.dateOnlyUtc(date)}`,
          });
        }
      });
      this.fwiLayer.on("tileerror", () =>
        A.Events.emit("service", {
          id: "effis",
          state: "error",
          note: T("map.wmsError"),
        }),
      );
      this.fwiLayer.addTo(this.map);
      this.makeLegend(
        "fwi",
        "EFFIS Fire Weather Index",
        `<div class="sourceNote">${T("map.fwiNote", { date: U.dateOnlyUtc(date) })}</div>`,
      );
    }
    toggleEffisBurntArea(show, date) {
      if (!show) {
        if (this.effisBurntAreaLayer)
          this.map.removeLayer(this.effisBurntAreaLayer);
        document.querySelector('[data-legend="burntArea"]')?.remove();
        return;
      }
      if (this.effisBurntAreaLayer)
        this.map.removeLayer(this.effisBurntAreaLayer);
      const d = date || new Date();
      this.effisBurntAreaLayer = L.tileLayer.wms(C.effisWms, {
        layers: C.effisBurntAreaLayer,
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        time: U.dateOnlyUtc(d),
        opacity: 0.5,
        pane: "riskPane",
        attribution: "EFFIS / Copernicus",
      });
      this.effisBurntAreaLayer.on("tileload", () =>
        A.Events.emit("service", {
          id: "effisBurntArea",
          state: "ok",
          note: `WMS ${C.effisBurntAreaLayer} · TIME=${U.dateOnlyUtc(d)}`,
        }),
      );
      this.effisBurntAreaLayer.on("tileerror", () =>
        A.Events.emit("service", {
          id: "effisBurntArea",
          state: "error",
          note: T("map.burntError"),
        }),
      );
      this.effisBurntAreaLayer.addTo(this.map);
      this.makeLegend(
        "burntArea",
        T("map.burntTitle"),
        `<div class="sourceNote">${T("map.burntNote", { date: U.dateOnlyUtc(d) })}</div>`,
      );
    }
    latestAllowedMtgSlot() {
      return this._mtgFrameMgr
        ? this._mtgFrameMgr.latestAllowed()
        : MtgFrameManager.roundToSlot(
            Date.now(),
            (C.mtgGeoColourWms.slotMinutes || 10) * 60 * 1000,
          );
    }
    roundToMtgSlot(date) {
      const ms = Number(date instanceof Date ? date.getTime() : date),
        slot = (C.mtgGeoColourWms.slotMinutes || 10) * 60 * 1000;
      return MtgFrameManager.roundToSlot(ms, slot);
    }
    async probeMtgTime(iso) {
      const wms = C.mtgGeoColourWms,
        bbox = wms.probeBbox || "35,26,43,46",
        u = `${wms.url}?SERVICE=WMS&VERSION=${wms.version}&REQUEST=GetMap&LAYERS=${wms.layer}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&BBOX=${bbox}&WIDTH=64&HEIGHT=64&CRS=EPSG:4326&TIME=${encodeURIComponent(iso)}`;
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (!r.ok)
          return ct.includes("text/html") || ct.includes("application/json")
            ? "invalid"
            : "no-frame";
        if (ct.startsWith("image/")) return "image";
        return ct.includes("text/html") || ct.includes("application/json")
          ? "invalid"
          : "no-frame";
      } catch (e) {
        return "network";
      }
    }
    createMtgLayer(date) {
      const wms = C.mtgGeoColourWms,
        mm = this;
      const mgr = (this._mtgFrameMgr = new MtgFrameManager(wms, {
        start: (iso) => {
          A.Events.emit("service", {
            id: "mtg",
            state: "loading",
            note: T("map.mtgLoading", { time: mtgFmt(iso) }),
          });
          A.Events.emit("mtgFrame", {
            state: "loading",
            selected: mgr.lastUserTime || iso,
            displayed: mm.mtgDisplayedTime,
            backfill: false,
          });
          mm.updateMtgLegend();
        },
        ok: (iso) => {
          mm.mtgDisplayedTime = iso;
          const backfill = Boolean(
              mgr.lastUserTime && iso !== mgr.lastUserTime,
            ),
            requested = backfill
              ? T("map.mtgRequested", { time: mtgFmt(mgr.lastUserTime) })
              : "";
          A.Events.emit("service", {
            id: "mtg",
            state: "ok",
            count: null,
            note: T("map.mtgOk", { time: mtgFmt(iso), requested }),
          });
          A.Events.emit("mtgFrame", {
            state: "ok",
            selected: mgr.lastUserTime || iso,
            displayed: iso,
            backfill,
          });
          mm.updateMtgLegend();
        },
        backfill: (req, target, n) => {
          A.Events.emit("service", {
            id: "mtg",
            state: "backfill",
            note: T("map.mtgBackfill", {
              requested: mtgFmt(mgr.lastUserTime || req),
              target: mtgFmt(target),
              attempt: n,
              max: mgr.maxBack,
            }),
          });
          A.Events.emit("mtgFrame", {
            state: "backfill",
            selected: mgr.lastUserTime || req,
            displayed: target,
            backfill: true,
          });
          mgr.applyBackfill(target);
          mm.mtgLayer.setParams({ time: target });
          mm.updateMtgLegend();
        },
        exhausted: (req, n) => {
          A.Events.emit("service", {
            id: "mtg",
            state: "no-frame",
            note: T("map.mtgExhausted", { time: mtgFmt(req), count: n }),
          });
          mm.updateMtgLegend();
        },
        invalid: () => {
          A.Events.emit("service", {
            id: "mtg",
            state: "error",
            note: T("map.mtgInvalid"),
          });
        },
        network: () => {
          A.Events.emit("service", {
            id: "mtg",
            state: "error",
            note: T("map.mtgNetwork"),
          });
        },
        probe: (iso) => mm.probeMtgTime(iso),
      }));
      const iso = mgr.normalize(date).toISOString(),
        opacity = U.clamp(
          Number(localStorage.getItem("mtgOpacity")) || wms.defaultOpacity,
          0.3,
          1,
        );
      const layer = L.tileLayer.wms(wms.url, {
        layers: wms.layer,
        format: wms.format,
        transparent: true,
        version: wms.version,
        crs: L.CRS ? L.CRS.EPSG4326 : null,
        time: iso,
        opacity,
        pane: "mtgPane",
        attribution: wms.attribution,
      });
      layer.on("tileloadstart", (e) => {
        e.tile.dataset.frameSeq = String(mgr.frameSeq);
      });
      layer.on("tileload", (e) =>
        mgr.tileLoad(Number(e.tile.dataset.frameSeq)),
      );
      layer.on("tileerror", (e) =>
        mgr.tileError(Number(e.tile.dataset.frameSeq)),
      );
      mgr.applyUserTime(iso);
      this.mtgLayer = layer;
      this.mtgRequestedTime = iso;
      this.mtgDisplayedTime = null;
      return layer;
    }
    toggleMtg(show, date) {
      if (!show) {
        clearTimeout(this._mtgDebounceT);
        this._mtgFrameMgr?.dispose();
        if (this.mtgLayer) this.map.removeLayer(this.mtgLayer);
        this.mtgLayer = null;
        this._mtgFrameMgr = null;
        this.mtgRequestedTime = null;
        this.mtgDisplayedTime = null;
        document.querySelector('[data-legend="mtg"]')?.remove();
        A.Events.emit("mtgFrame", {
          state: "off",
          selected: null,
          displayed: null,
          backfill: false,
        });
        return;
      }
      if (!this.mtgLayer)
        this.createMtgLayer(date || new Date()).addTo(this.map);
      else if (!this.map.hasLayer(this.mtgLayer))
        this.map.addLayer(this.mtgLayer);
      this.setMtgTime(date || new Date());
      this.makeLegend("mtg", "EUMETSAT MTG-I GeoColour", this.mtgLegendBody());
    }
    setMtgTime(date) {
      if (!this.mtgLayer || !this._mtgFrameMgr) return;
      const mgr = this._mtgFrameMgr,
        iso = mgr.normalize(this.roundToMtgSlot(date)).toISOString();
      if (iso === mgr.lastUserTime) return;
      clearTimeout(this._mtgDebounceT);
      this._mtgDebounceT = setTimeout(() => {
        mgr.applyUserTime(iso);
        this.mtgLayer.setParams({ time: iso });
        this.mtgRequestedTime = iso;
        this.updateMtgLegend();
      }, 200);
    }
    mtgLegendBody() {
      const mgr = this._mtgFrameMgr,
        req = mgr?.lastUserTime,
        disp = mgr?.displayedTime,
        lines = [T("map.mtgReal", { source: C.mtgGeoColourWms.source })];
      if (req && disp && req !== disp)
        lines.push(
          `${T("map.mtgSelected", { time: mtgFmt(req) })}<br>${T("map.mtgFrame", { time: mtgFmt(disp) })}`,
        );
      else if (disp) lines.push(T("map.mtgFrame", { time: mtgFmt(disp) }));
      else if (req)
        lines.push(
          T("map.mtgLoadingShort", {
            selected: T("map.mtgSelected", { time: mtgFmt(req) }),
          }),
        );
      if (
        mgr &&
        mgr.lastUserTime &&
        mgr.lastUserTime >= mgr.latestAllowed().toISOString()
      )
        lines.push(T("map.mtgLatest"));
      return `<div class="sourceNote">${lines.join("<br>")}</div>`;
    }
    updateMtgLegend() {
      const legend = document.querySelector('[data-legend="mtg"]');
      if (legend)
        legend.querySelector(".legendBody").innerHTML = this.mtgLegendBody();
    }
    setFootprint(events, show = true) {
      this.footprintLayer.clearLayers();
      if (this.map.hasLayer(this.footprintLayer))
        this.map.removeLayer(this.footprintLayer);
      document.querySelector('[data-legend="footprint"]')?.remove();
      if (!show || !events?.length) return;
      for (const ev of events) {
        if (!ev.members?.length) continue;
        for (const m of ev.members) {
          if (
            !Number.isFinite(m.scan) ||
            !Number.isFinite(m.track) ||
            m.scan <= 0 ||
            m.track <= 0
          )
            continue;
          const scan = m.scan,
            track = m.track;
          const kmPerLat = 110.574,
            kmPerLon = 111.32 * Math.cos((m.lat * Math.PI) / 180);
          const halfLon = Math.max(0.0005, scan / 2 / kmPerLon);
          const halfLat = Math.max(0.0005, track / 2 / kmPerLat);
          L.rectangle(
            [
              [m.lat - halfLat, m.lon - halfLon],
              [m.lat + halfLat, m.lon + halfLon],
            ],
            {
              pane: "riskPane",
              color: "rgba(255,100,50,0.35)",
              weight: 0.5,
              fillColor: "rgba(255,80,40,0.08)",
              fillOpacity: 0.12,
              interactive: false,
            },
          ).addTo(this.footprintLayer);
        }
      }
      this.footprintLayer.addTo(this.map);
      this.makeLegend(
        "footprint",
        T("map.footprintTitle"),
        `<div class="legendLine"><i style="background:rgba(255,80,40,0.2);border:1px solid rgba(255,100,50,0.5)"></i><span>${T("map.footprintBody")}</span></div><div class="sourceNote">${T("map.footprintNote")}</div>`,
      );
    }
    toggleFootprint(show) {
      if (show) {
        if (!this.map.hasLayer(this.footprintLayer))
          this.footprintLayer.addTo(this.map);
      } else {
        if (this.map.hasLayer(this.footprintLayer))
          this.map.removeLayer(this.footprintLayer);
        document.querySelector('[data-legend="footprint"]')?.remove();
      }
    }
    setThermalEnvelope(events, show = true) {
      this.thermalEnvelopeLayer.clearLayers();
      if (this.map.hasLayer(this.thermalEnvelopeLayer))
        this.map.removeLayer(this.thermalEnvelopeLayer);
      document.querySelector('[data-legend="thermal"]')?.remove();
      if (!show || !events?.length) return;
      let count = 0;
      for (const ev of events) {
        const members = (ev.members || []).filter(
          (m) => Number.isFinite(m.lat) && Number.isFinite(m.lon),
        );
        if (members.length < 2) continue;
        const maxTi = members.reduce(
          (mx, m) =>
            Math.max(mx, Number(m.brightTi4) || 0, Number(m.brightTi5) || 0),
          0,
        );
        if (maxTi <= 0) continue;
        const hull = U.convexHull2D(members);
        if (hull.length < 3) continue;
        const hue = maxTi > 360 ? 30 : maxTi > 320 ? 15 : 0;
        const light = U.clamp(55 + (maxTi - 300) * 0.3, 35, 75);
        const coords = hull.map((p) => [p.lat, p.lon]);
        coords.push(coords[0]);
        L.polygon(coords, {
          pane: "firePane",
          color: `hsl(${hue},90%,${light}%)`,
          weight: 2,
          fillColor: `hsl(${hue},85%,${light + 8}%)`,
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(this.thermalEnvelopeLayer);
        count++;
      }
      if (count) {
        this.thermalEnvelopeLayer.addTo(this.map);
        this.makeLegend(
          "thermal",
          T("map.thermalTitle"),
          `<div class="legendLine"><i style="background:hsl(0,90%,45%);opacity:0.5"></i><span>${T("map.thermalLow")}</span></div><div class="legendLine"><i style="background:hsl(15,90%,55%);opacity:0.5"></i><span>${T("map.thermalMedium")}</span></div><div class="legendLine"><i style="background:hsl(30,90%,65%);opacity:0.5"></i><span>${T("map.thermalHigh")}</span></div><div class="sourceNote">${T("map.thermalNote")}</div>`,
        );
      }
    }
    toggleThermalEnvelope(show) {
      if (show) {
        if (!this.map.hasLayer(this.thermalEnvelopeLayer))
          this.thermalEnvelopeLayer.addTo(this.map);
      } else {
        if (this.map.hasLayer(this.thermalEnvelopeLayer))
          this.map.removeLayer(this.thermalEnvelopeLayer);
        document.querySelector('[data-legend="thermal"]')?.remove();
      }
    }
    setEventEvolution(events, show = true) {
      this.evolutionLayer.clearLayers();
      if (this.map.hasLayer(this.evolutionLayer))
        this.map.removeLayer(this.evolutionLayer);
      document.querySelector('[data-legend="evolution"]')?.remove();
      if (!show || !events?.length) return;
      let count = 0;
      for (const ev of events) {
        if (!ev.members || ev.members.length < 2) continue;
        const sorted = [...ev.members].sort(
          (a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt),
        );
        const path = sorted.map((m) => [m.lat, m.lon]);
        if (path.length < 2) continue;
        const age = U.ageHours(ev.latestDetectedAt);
        const opacity = age <= 6 ? 0.7 : age <= 12 ? 0.5 : 0.3;
        L.polyline(path, {
          pane: "riskPane",
          color: "#ff6b35",
          weight: 2,
          opacity,
          dashArray: "4 5",
          interactive: false,
        }).addTo(this.evolutionLayer);
        const oldest = sorted[0],
          newest = sorted[sorted.length - 1];
        L.circleMarker([oldest.lat, oldest.lon], {
          pane: "riskPane",
          radius: 3,
          color: "#aaa",
          weight: 1,
          fillColor: "#fff",
          fillOpacity: 0.5,
          interactive: false,
        }).addTo(this.evolutionLayer);
        L.circleMarker([newest.lat, newest.lon], {
          pane: "riskPane",
          radius: 3,
          color: "#ff6b35",
          weight: 1.5,
          fillColor: "#ff6b35",
          fillOpacity: 0.8,
          interactive: false,
        }).addTo(this.evolutionLayer);
        count++;
      }
      if (count) {
        this.evolutionLayer.addTo(this.map);
        this.makeLegend(
          "evolution",
          T("map.evolutionTitle"),
          `<div class="legendLine"><i style="background:#ff6b35;height:2px;border-top:2px dashed #ff6b35"></i><span>${T("map.evolutionPath")}</span></div><div class="legendLine"><span>○</span><span>${T("map.oldest")}</span></div><div class="legendLine"><span>●</span><span>${T("map.newest")}</span></div><div class="sourceNote">${T("map.evolutionNote")}</div>`,
        );
      }
    }
    toggleEventEvolution(show) {
      if (show) {
        if (!this.map.hasLayer(this.evolutionLayer))
          this.evolutionLayer.addTo(this.map);
      } else {
        if (this.map.hasLayer(this.evolutionLayer))
          this.map.removeLayer(this.evolutionLayer);
        document.querySelector('[data-legend="evolution"]')?.remove();
      }
    }
    firesDetectionTooltip(f, history, reference) {
      const out = [`<strong>${T("detail.thermal")}</strong>`];
      const src = U.escapeHtml(f.product || f.source || "");
      if (src) out.push(src);
      if (Number.isFinite(Number(f.frp)))
        out.push(`FRP: ${U.round(Number(f.frp), 2)} MW`);
      const h =
        history && history.records
          ? history
          : { count: 0, first: null, last: null, window48: false };
      if (h.count === 1) {
        out.push(T("map.singleDetection"));
      } else {
        const first = h.first
          ? U.formatTrShortDateTime(new Date(h.first))
          : null;
        const last = h.last ? U.formatTrShortDateTime(new Date(h.last)) : null;
        if (first)
          out.push(
            `${T(h.window48 ? "detail.first48" : "detail.first")}: ${first}`,
          );
        if (last) out.push(`${T("detail.last")}: ${last}`);
      }
      const age = U.formatAgeSince(h.last || f.detectedAt, reference);
      if (age) out.push(T("map.lastAge", { age }));
      if (h.count > 1) out.push(T("map.areaCount", { count: I.formatNumber(h.count) }));
      return out.join("<br>");
    }
    firesEventTooltip(ev, history, reference, opts = {}) {
      const out = [
        `<strong>${T("map.eventCluster")}</strong> · ${T("summary.detections", { count: I.formatNumber(ev.count) })}`,
        T("sparkline.title"),
      ];
      const spark = this.fireSparklineData(ev, reference);
      if (spark) out.push(this.fireFrpChart(spark));
      else out.push(T("sparkline.empty"));
      const h =
        history && history.records
          ? history
          : { count: 0, first: null, last: null, window48: false };
      const rows = [];
      if (spark)
        rows.push(
          `<span>${T("analysis.maxFrp")}</span><span>${I.formatNumber(U.round(spark.maxFrp, 1))} MW</span>`,
        );
      if (h.count === 1) {
        rows.push(`<span class="fire-popup-full">${T("map.singleDetection")}</span>`);
      } else {
        const first = h.first ? U.formatCompactDateTime(new Date(h.first)) : null;
        const last = h.last ? U.formatCompactDateTime(new Date(h.last)) : null;
        if (first && last)
          rows.push(
            `<span>${T("sparkline.firstLast")}</span><span>${first} · ${last}</span>`,
          );
        else if (first)
          rows.push(`<span>${T("sparkline.firstLast")}</span><span>${first}</span>`);
      }
      const age = U.formatAgeShort(h.last || ev.latestDetectedAt, reference);
      if (age)
        rows.push(
          `<span>${T("sparkline.lastSeen")}</span><span>${U.escapeHtml(age)}</span>`,
        );
      if (rows.length)
        out.push(`<div class="fire-popup-metrics">${rows.join("")}</div>`);
      if (opts.withDetails)
        out.push(
          `<a class="fire-event-detail" href="#" data-id="${U.escapeHtml(String(ev.id))}" data-lat="${ev.lat}" data-lon="${ev.lon}">${T("map.viewDetails")}</a>`,
        );
      return out.join("<br>");
    }
    fireSparklineData(ev, reference) {
      const endMs = Math.min(
          new Date(reference).getTime(),
          Date.now() + 15 * 60e3,
        ),
        key = `${ev.id}|${endMs}`,
        cached = this._sparkCache.get(key);
      if (cached !== undefined) return cached;
      const near = this.fireAll.filter(
        (f) =>
          U.haversineKm({ lat: ev.lat, lon: ev.lon }, f) <=
          C.NEARBY_FIRMS_RADIUS_KM,
      );
      const points = U.sparklinePoints(near, { endMs, minFrp: 5, maxPoints: 12 });
      let result = null;
      if (points.length) {
        result = {
          points,
          endMs,
          start: endMs - 48 * 3600e3,
          maxFrp: Math.max(...points.map((p) => Number(p.frp))),
        };
      }
      this._sparkCache.set(key, result);
      return result;
    }
    fireFrpChart(spark) {
      const W = 176,
        H = 52,
        barW = 9,
        buckets = 12,
        bucketMs = 4 * 3600e3,
        plotT = 8,
        plotB = 14,
        plotH = H - plotT - plotB,
        slot = W / buckets,
        maxFrp = Math.max(...spark.points.map((p) => Number(p.frp))),
        minH = 5,
        height = (frp) => Math.max(minH, (frp / maxFrp) * plotH),
        x = (idx) => slot * idx + (slot - barW) / 2,
        y = (frp) => plotT + plotH - (frp / maxFrp) * plotH,
        idxOf = (t) =>
          Math.min(
            buckets - 1,
            Math.max(0, Math.floor((Date.parse(t) - spark.start) / bucketMs)),
          );
      const heights = new Array(buckets).fill(0);
      for (const p of spark.points) {
        const idx = idxOf(p.detectedAt);
        heights[idx] = Math.max(heights[idx], Number(p.frp));
      }
      const parts = [];
      for (let i = 0; i < buckets; i++) {
        if (heights[i] > 0) {
          parts.push(
            `<rect x="${x(i).toFixed(1)}" y="${y(heights[i]).toFixed(1)}" width="${barW}" height="${height(heights[i]).toFixed(1)}" rx="1.5" fill="#f2a35c"/>`,
          );
        } else {
          parts.push(
            `<rect x="${x(i).toFixed(1)}" y="${(plotT + plotH - 1).toFixed(1)}" width="${barW}" height="1" fill="#e5edf3"/>`,
          );
        }
      }
      const baselineY = plotT + plotH + 0.5;
      parts.push(
        `<line x1="0" y1="${baselineY}" x2="${W}" y2="${baselineY}" stroke="#94a8ba" stroke-width="1"/>`,
        `<text x="0" y="${H - 2}" font-size="9" fill="#64788c">${U.escapeHtml(U.formatCompactHour(new Date(spark.start)))}</text>`,
        `<text x="${W / 2}" y="${H - 2}" font-size="9" fill="#64788c" text-anchor="middle">${U.escapeHtml(U.formatCompactHour(new Date(spark.start + 24 * 3600e3)))}</text>`,
        `<text x="${W}" y="${H - 2}" font-size="9" fill="#64788c" text-anchor="end">${U.escapeHtml(T("sparkline.now"))}</text>`,
      );
      return `<div class="fire-frp-chart"><svg class="fire-frp-bars" width="100%" height="${H}" viewBox="0 0 ${W} ${H}" focusable="false" role="img" aria-label="${U.escapeHtml(T("sparkline.title"))}"><g aria-hidden="true">${parts.join("")}</g></svg></div>`;
    }
    substationIcon() {
      return L.divIcon({
        className: "substationIconWrap",
        html: '<span class="substationSquare"></span>',
        iconSize: [7, 7],
        iconAnchor: [3.5, 3.5],
      });
    }
    riskSubstationIcon() {
      return L.divIcon({
        className: "substationIconWrap",
        html: '<span class="substationSquare substation-risk"></span>',
        iconSize: [7, 7],
        iconAnchor: [3.5, 3.5],
      });
    }
    substationRenderData(data) {
      const country = C.activeCountryCode,
        bounds = this.map.getBounds().pad(0.12),
        candidates = (data.features || []).filter((f) => {
          const c = f.geometry?.coordinates;
          return (
            f.properties?.countryCode === country &&
            c &&
            Number.isFinite(c[0]) &&
            Number.isFinite(c[1]) &&
            U.insideRegion({ lat: c[1], lon: c[0] }) &&
            bounds.contains([c[1], c[0]])
          );
        });
      const limit = this.zoom() < 7 ? 1800 : 6000;
      if (candidates.length <= limit) return { ...data, features: candidates };
      const size = this.map.getSize(),
        cell = Math.max(6, Math.sqrt(Math.max(1, size.x * size.y) / limit)),
        cells = new Map();
      for (const feature of candidates
        .slice()
        .sort((a, b) =>
          String(a.properties?.assetId || "").localeCompare(
            String(b.properties?.assetId || ""),
          ),
        )) {
        const c = feature.geometry.coordinates,
          p = this.map.latLngToContainerPoint([c[1], c[0]]),
          key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
        if (!cells.has(key)) cells.set(key, feature);
      }
      return { ...data, features: [...cells.values()] };
    }
    refreshSubstationLayer() {
      const data = this.gridData.get("substations"),
        layer = this.gridLayers.get("substations");
      if (!data || !layer || !this.map.hasLayer(layer)) return;
      this.map.removeLayer(layer);
      this.gridLayers.delete("substations");
      this.setGridGroup("substations", data, true);
    }
    async setGridGroup(key, data, show) {
      if (data) this.gridData.set(key, data);
      if (this.gridLayers.has(key)) {
        const layer = this.gridLayers.get(key);
        if (show && !this.map.hasLayer(layer)) layer.addTo(this.map);
        if (!show && this.map.hasLayer(layer)) this.map.removeLayer(layer);
        this.updateGridLegend();
        return;
      }
      if (!show || !data) return;
      const cfg = C.gridSources[key],
        country = C.activeCountryCode,
        countryFilter = (f) => {
          if (f.properties?.countryCode !== country) return false;
          if (key === "substations") {
            const c = f.geometry?.coordinates;
            return c && U.insideRegion({ lat: c[1], lon: c[0] });
          }
          const coords =
            f.geometry?.type === "LineString"
              ? [f.geometry.coordinates]
              : f.geometry?.type === "MultiLineString"
                ? f.geometry.coordinates
                : [];
          return coords.some((line) =>
            line.some((c) => U.insideRegion({ lat: c[1], lon: c[0] })),
          );
        };
      const renderData =
        key === "substations" ? this.substationRenderData(data) : data;
      let layer;
      if (key === "substations")
        layer = L.geoJSON(renderData, {
          filter: countryFilter,
          pane: "gridPane",
          pointToLayer: (f, latlng) =>
            L.marker(latlng, {
              pane: "gridPane",
              icon: this.substationIcon(f.properties),
            }),
          onEachFeature: (f, l) => {
            l.bindTooltip(this.gridTooltip(f.properties, true), {
              sticky: true,
            });
            l.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              this.onPointClick?.({
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                gridFeature: {
                  kind: "substation",
                  properties: f.properties,
                  geometry: f.geometry,
                },
              });
            });
          },
        });
      else
        layer = L.geoJSON(renderData, {
          filter: countryFilter,
          pane: "gridPane",
          style: () => ({
            pane: "gridPane",
            renderer: this.renderer,
            color: cfg.color,
            weight: cfg.weight,
            opacity: key === "400" ? 0.84 : 0.78,
          }),
          onEachFeature: (f, l) => {
            l.bindTooltip(this.gridTooltip(f.properties, false), {
              sticky: true,
            });
            l.on("mouseover", () =>
              l.setStyle({
                weight: cfg.weight + 1,
                opacity: 1,
                color: cfg.color,
              }),
            );
            l.on("mouseout", () =>
              l.setStyle({
                weight: cfg.weight,
                opacity: key === "400" ? 0.84 : 0.78,
                color: cfg.color,
              }),
            );
            l.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              this.onPointClick?.({
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                gridFeature: {
                  kind: "line",
                  group: key,
                  properties: f.properties,
                  geometry: f.geometry,
                },
              });
            });
          },
        });
      this.gridLayers.set(key, layer);
      layer.addTo(this.map);
      this.updateGridLegend();
    }
    gridTooltip(p, isSub) {
      const actual = U.formatVoltage(p.actualVoltageKv) || T("common.unknown"),
        title = T(isSub ? "detail.substation" : "detail.line"),
        label =
          p.name ||
          p.ref ||
          p.displayLabel ||
          (isSub ? T("detail.substation") : T("detail.undefinedLine")),
        rows = [`<strong>${title}</strong>`, U.escapeHtml(label)];
      if (!isSub)
        rows.push(
          `${T("detail.gridClass")}: ${U.escapeHtml(p.displayClass || T("detail.kvClass", { value: p.gridClass }))}`,
        );
      rows.push(`${T("detail.actualVoltage")}: ${U.escapeHtml(actual)}`);
      if (p.ref) rows.push(`${T("common.reference")}: ${U.escapeHtml(p.ref)}`);
      if (p.operator)
        rows.push(`${T("common.operator")}: ${U.escapeHtml(p.operator)}`);
      rows.push("<small>OpenStreetMap / ODbL 1.0</small>");
      return rows.join("<br>");
    }
    hideAllGrid() {
      for (const layer of this.gridLayers.values())
        if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
      this.updateGridLegend();
    }
    updateGridLegend() {
      const active = [...this.gridLayers.entries()]
        .filter(([, l]) => this.map.hasLayer(l))
        .map(([k]) => k);
      document.querySelector('[data-legend="grid"]')?.remove();
      if (!active.length) return;
      this.makeLegend(
        "grid",
        T("map.gridTitle", { country: I.countryName(C.activeCountryCode) }),
        `${active.map((k) => `<div class="legendLine"><i style="background:${C.gridSources[k].color}"></i><span>${T(C.gridSources[k].labelKey) || C.gridSources[k].label}${k === "400" ? ` — ${T("map.gridColor400")}` : k === "154" ? ` — ${T("map.gridColor154")}` : ""}</span></div>`).join("")}<div class="sourceNote">${T("map.gridNote")}</div>`,
      );
    }
    riskSubstationCandidates(analyses) {
      const selected = new Map();
      for (const a of analyses || []) {
        const s = a.nearest?.substation,
          props = s?.feature?.props || {};
        if (
          (a.event &&
            !U.insideRegion({ lat: a.event.lat, lon: a.event.lon })) ||
          (props.countryCode && props.countryCode !== C.activeCountryCode) ||
          !s ||
          !Number.isFinite(s.distanceKm) ||
          s.distanceKm > C.substationRiskDisplayDistanceKm
        )
          continue;
        const key = props.assetId || s.feature?.id || s.key;
        if (!key) continue;
        const old = selected.get(key);
        if (!old || Number(a.riskScore || 0) > Number(old.riskScore || 0))
          selected.set(key, { ...a, substation: s });
      }
      return [...selected.values()];
    }
    setFireImpacts(analyses, show = true) {
      this.lastRiskAnalyses = analyses || [];
      this.lastRiskVisible = show;
      this.riskLayer.clearLayers();
      this.riskAssetLayer.clearLayers();
      document.querySelector('[data-legend="risk"]')?.remove();
      if (!show) return;
      let rendered = false;
      for (const a of analyses || []) {
        if (!U.insideRegion({ lat: a.event.lat, lon: a.event.lon })) continue;
        const c = U.riskColor(a.riskBand?.level || "watch");
        if (a.riskBand && a.riskScore >= 20) {
          const r = U.clamp(
            7 + (100 - a.riskScore) * -0.015 + a.event.count * 0.25,
            7,
            15,
          );
          L.circleMarker([a.event.lat, a.event.lon], {
            pane: "riskPane",
            renderer: this.renderer,
            radius: r,
            color: c,
            weight: a.riskScore >= 75 ? 3 : 2,
            fill: false,
            opacity: 0.95,
            interactive: false,
          }).addTo(this.riskLayer);
          rendered = true;
        }
        if (a.riskScore >= 55) {
          const l = a.nearest?.line;
          if (l) {
            L.polyline(
              [
                [l.feature.a.lat, l.feature.a.lon],
                [l.feature.b.lat, l.feature.b.lon],
              ],
              {
                pane: "riskPane",
                color: "#fff",
                weight: 8,
                opacity: 0.55,
                interactive: false,
              },
            ).addTo(this.riskAssetLayer);
            L.polyline(
              [
                [l.feature.a.lat, l.feature.a.lon],
                [l.feature.b.lat, l.feature.b.lon],
              ],
              {
                pane: "riskPane",
                color: c,
                weight: 5,
                opacity: 0.95,
                interactive: false,
              },
            ).addTo(this.riskAssetLayer);
            rendered = true;
          }
        }
      }
      for (const a of this.riskSubstationCandidates(analyses)) {
        const s = a.substation,
          c = U.riskColor(a.riskBand?.level || "watch");
        L.marker([s.feature.lat, s.feature.lon], {
          pane: "riskPane",
          icon: this.riskSubstationIcon(),
          interactive: false,
        }).addTo(this.riskAssetLayer);
        rendered = true;
      }
      if (rendered)
        this.makeLegend(
          "risk",
          T("map.riskTitle"),
          `${C.riskScoreBands.map((b) => `<div class="legendLine"><i class="dot" style="background:${U.riskColor(b.level)}"></i><span>${b.min}+ · ${T(`risk.${b.level}`)}</span></div>`).join("")}<div class="legendLine"><span class="substationSquare substation-risk" style="display:inline-block"></span><span>${T("map.substationRisk", { distance: C.substationRiskDisplayDistanceKm })}</span></div><div class="sourceNote">${T("map.riskNote", { distance: C.substationRiskDisplayDistanceKm })}</div>`,
        );
    }
    showRiskEvidence(evidence) {
      this.lastRiskEvidence = evidence || null;
      this.riskEvidenceLayer.clearLayers();
      document.querySelector('[data-legend="evidence"]')?.remove();
      if (!evidence) return;
      const c = U.riskColor(evidence.riskLevel || "watch"),
        trigger = {
          lat: Number(evidence.triggerLatitude),
          lon: Number(evidence.triggerLongitude),
        },
        nearest = {
          lat: Number(evidence.nearestLineLatitude),
          lon: Number(evidence.nearestLineLongitude),
        };
      if (
        !Number.isFinite(trigger.lat) ||
        !Number.isFinite(trigger.lon) ||
        !Number.isFinite(nearest.lat) ||
        !Number.isFinite(nearest.lon)
      ) {
        this.makeLegend(
          "evidence",
          T("map.evidenceTitle"),
          `<div class="sourceNote">${T("detail.evidenceSpatialFail")}</div>`,
        );
        return;
      }
      L.circleMarker([trigger.lat, trigger.lon], {
        pane: "riskPane",
        renderer: this.renderer,
        radius: 11,
        color: c,
        weight: 3,
        fill: false,
        opacity: 1,
        interactive: true,
      })
        .bindTooltip(T("map.evidenceTriggerTooltip"), { sticky: true })
        .addTo(this.riskEvidenceLayer);
      L.circleMarker([trigger.lat, trigger.lon], {
        pane: "riskPane",
        renderer: this.renderer,
        radius: 3.5,
        color: c,
        weight: 1,
        fill: true,
        fillColor: c,
        fillOpacity: 0.95,
        opacity: 1,
        interactive: false,
      }).addTo(this.riskEvidenceLayer);
      L.polyline(
        [
          [trigger.lat, trigger.lon],
          [nearest.lat, nearest.lon],
        ],
        {
          pane: "riskPane",
          renderer: this.renderer,
          color: c,
          weight: 2,
          opacity: 0.9,
          dashArray: "2 7",
          interactive: false,
        },
      ).addTo(this.riskEvidenceLayer);
      L.circleMarker([nearest.lat, nearest.lon], {
        pane: "riskPane",
        renderer: this.renderer,
        radius: 6,
        color: "#0b1a26",
        weight: 2.5,
        fill: true,
        fillColor: "#ffffff",
        fillOpacity: 1,
        opacity: 1,
        interactive: true,
      })
        .bindTooltip(
          T("map.evidenceNearestTooltip", {
            distance: U.round(evidence.triggerDistanceKm, 2),
          }),
          { sticky: true },
        )
        .addTo(this.riskEvidenceLayer);
      this.makeLegend(
        "evidence",
        T("map.evidenceTitle"),
        `<div class="legendLine"><span class="evidencePixelSample"></span><span>${T("map.evidencePixel")}</span></div><div class="legendLine"><span class="evidenceLinkSample"></span><span>${T("map.evidenceLink")}</span></div><div class="legendLine"><span class="evidenceNearestSample"></span><span>${T("map.evidenceNearest")}</span></div><div class="legendLine"><span class="dot" style="background:${c}"></span><span>${T("map.eventClusterCenter")}</span></div><div class="sourceNote">${T("detail.clusterCenterNote")}</div>`,
      );
    }
    clearRiskEvidence() {
      this.lastRiskEvidence = null;
      this.riskEvidenceLayer.clearLayers();
      document.querySelector('[data-legend="evidence"]')?.remove();
    }
    refreshLocalizedContent() {
      if (!this.map || !this.fireLayer) return;
      this.renderFires(this.currentSelectedTime);
      if (this.airData.length) this.updateSmokeLegend();
      this.updateGridLegend();
      if (this.lastRiskVisible)
        this.setFireImpacts(this.lastRiskAnalyses, true);
      if (this.lastRiskEvidence) this.showRiskEvidence(this.lastRiskEvidence);
      if (this.lastDownwindVisible)
        this.setDownwindCorridors(this.lastDownwindAnalyses, true);
      if (this.lastWindVector) {
        const v = this.lastWindVector;
        this.drawWindVector(v.point, v.direction, v.speed, v.level, v.validAt);
      }
      this.updateMtgLegend();
    }
  }
  A.MapManager = MapManager;
  A.MtgFrameManager = MtgFrameManager;
})(window.AtmoApp);
