(function (A) {
  const U = A.Utils,
    C = A.CONFIG,
    I = A.I18n,
    T = (key, params) => I.t(key, params);
  class Application {
    constructor() {
      this.ui = new A.UIManager();
      this.map = new A.MapManager();
      this.grid = new A.GridRepository();
      this.state = {
        countryCode: "TR",
        countrySeq: 0,
        countryAbortController: null,
        countryBoundary: null,
        countryManifest: null,
        selectedTime: new Date(),
        smokeVariable: null,
        smokeData: [],
        wildfireSummaryData: [],
        fireData: [],
        fireEvents: [],
        fireImpacts: [],
        windData: [],
        surfaceWindData: [],
        windEnabled: false,
        windLevel: "10m",
        fwiEnabled: false,
        effisBurntAreaEnabled: true,
        mtgEnabled: false,
        firesEnabled: true,
        heatEnabled: false,
        impactEnabled: true,
        riskEvidenceEnabled: true,
        downwindEnabled: true,
        gridMaster: true,
        selectedPoint: null,
        frpThreshold: C.frpThreshold,
        slstrEnabled: false,
        slstrAEnabled: true,
        slstrBEnabled: true,
        mtgFrpEnabled: false,
        multiSensorEnabled: false,
        slstrData: [],
        slstrStatus: "idle",
        mtgFrpData: [],
        multiSensorEvents: [],
      };
      this.controllers = {
        air: null,
        wind: null,
        firms: null,
        detail: null,
        health: null,
      };
      this.reqSeq = { air: 0, wind: 0, firms: 0, detail: 0, health: 0, thermal: 0 };
      this.moveTimer = null;
      this.timeTimer = null;
      this.playTimer = null;
      this.thermalTimer = null;
      this._thermalWindowKey = null;
      this.lastApiCall = 0;
      this.resizeT = null;
      this.countryManager = new A.CountryManager(this);
    }
    async init() {
      this.ui.init();
      this.map.init((p) => this.selectPoint(p));
      this.bindUI();
      this.restoreSettings();
      this.ui.setTime(this.state.selectedTime);
      this.ui.setUpdated();
      A.Events.on("focusRisk", (a) => {
        if (!a?.event || a.event.countryCode !== this.state.countryCode) return;
        this.ui.showView("map");
        this.map.setView(a.event.lat, a.event.lon, 10);
        this.selectPoint({
          lat: a.event.lat,
          lon: a.event.lon,
          fire: a.event.representative,
          fireEvent: a.event,
          riskEvidence: a.evidence,
        });
      });
      A.Events.on("basemapStatus", (x) =>
        A.Events.emit("service", {
          id: "basemap",
          state: "ok",
          note: `${x.key} · ${T(x.mode === "proxy" ? "ui.basemapProxy" : "ui.basemapDirect")}`,
        }),
      );
      A.Events.on("basemapError", (x) => {
        A.Events.emit("service", {
          id: "basemap",
          state: "error",
          note: x.note || T("ui.basemapError"),
        });
        this.ui.toast(x.note || T("ui.basemapFallback"), "warn");
      });
      A.Events.on("outsideDataRegion", () =>
        this.ui.toast(
          T("ui.outsideQueries", {
            country: I.countryName(this.state.countryCode),
          }),
          "warn",
        ),
      );
      await this.countryManager.init();
      this.map.map.on("moveend", () => {
        clearTimeout(this.moveTimer);
        this.moveTimer = setTimeout(() => {
          const now = Date.now();
          if (now - this.lastApiCall < 5000) return;
          this.lastApiCall = now;
          this.loadSmokeGrid();
          setTimeout(() => this.loadWindGrid(), 600);
        }, 2000);
      });
      window.addEventListener("resize", () => this.scheduleResize());
      window.addEventListener("orientationchange", () => this.scheduleResize());
    }
    scheduleResize() {
      clearTimeout(this.resizeT);
      this.resizeT = setTimeout(() => {
        this.ui.syncLayerPanelPlacement();
        const v = document.getElementById("view-map");
        if (v?.classList.contains("active")) this.map?.map?.invalidateSize();
      }, 150);
    }
    abortCountryRequests() {
      for (const controller of Object.values(this.controllers))
        controller?.abort?.("country-switch");
      for (const key of Object.keys(this.reqSeq)) this.reqSeq[key]++;
      clearTimeout(this.moveTimer);
      clearTimeout(this.timeTimer);
      clearTimeout(this.thermalTimer);
      this._thermalWindowKey = null;
    }
    resetCountryState(code) {
      this.grid.reset();
      this.map.resetCountry();
      Object.assign(this.state, {
        countryCode: code,
        countryBoundary: null,
        countryManifest: null,
        smokeData: [],
        wildfireSummaryData: [],
        fireData: [],
        fireEvents: [],
        fireImpacts: [],
        windData: [],
        surfaceWindData: [],
        selectedPoint: null,
        slstrData: [],
        slstrStatus: "idle",
        mtgFrpData: [],
        multiSensorEvents: [],
      });
      this._thermalWindowKey = null;
      if (A.ThermalSources) {
        const altIds = ["sentinel3a-slstr", "sentinel3b-slstr", "mtg-fci-frp", "multi-sensor"];
        const baseSeq = (A.ThermalSources.state("sentinel3a-slstr").seq || 0) + 1;
        for (const id of altIds) {
          A.ThermalSources.patchState(id, {
            status: "idle",
            data: [],
            error: null,
            count: 0,
            seq: baseSeq,
            metrics: A.ThermalSources.defaultMetrics(),
            lastErrorAt: null,
          });
        }
      }
      const statusEl = document.getElementById("sentinelSlstrStatus");
      if (statusEl) statusEl.textContent = T("thermal.orchestrator.none");
      this.ui.renderImpact([]);
      this.ui.renderExportSummary(this.state);
      document.getElementById("analysisPointSummary").innerHTML =
        `<p>${T("analysis.noSelection")}</p>`;
    }
    async onCountryReady({ seq, code, country, manifest }) {
      if (seq !== this.state.countrySeq || code !== this.state.countryCode)
        return;
      this.updateImpact();
      this.renderGridStaggered();
      this.healthCheck(false);
      this.loadSmokeGrid();
      this.loadWindGrid(true);
      if (this.state.fwiEnabled)
        this.map.toggleFwi(true, this.state.selectedTime);
      if (this.state.effisBurntAreaEnabled)
        this.map.toggleEffisBurntArea(true, this.state.selectedTime);
      if (this.state.mtgEnabled)
        this.map.toggleMtg(true, this.state.selectedTime);
      if (C.firmsMapKey && C.firmsMapKey !== "__FIRMS_MAP_KEY__")
        this.loadFirms().finally(() => this.loadThermalSources());
      else {
        A.Events.emit("service", {
          id: "firms",
          state: "warn",
          note: T("ui.firmsInactive", { country: I.countryName(country.code) }),
        });
        this.loadThermalSources();
      }
      document.querySelectorAll("[data-feature-flag]").forEach((el) => {
        const flagId = el.dataset.featureFlag;
        if (!flagId) return;
        const on = A.ThermalSources.registry.isEnabled(flagId);
        el.hidden = !on;
        const label = el.closest("label");
        if (label) label.hidden = !on;
        const dep = document.querySelector(
          `[data-feature-flag-depends-on="${flagId}"]`,
        );
        if (dep) dep.hidden = !on;
      });
      this.ui.setUpdated();
    }
    restoreSettings() {
      document.getElementById("firmsSource").value = A.FirmsAdapter.source();
      const thermalMode = A.ThermalSources.getMode();
      document.getElementById("thermalModeSelect").value = thermalMode;
      A.ThermalSources.setMode(thermalMode);
      this.syncThermalModeUI();
      const wl = localStorage.getItem("windLevel");
      if (C.windLevels[wl]) this.state.windLevel = wl;
      document.getElementById("windLevel").value = this.state.windLevel;
      document.getElementById("baseMapSelect").value =
        this.map.baseKey || "satellite";
      document.getElementById("frpThreshold").value = this.state.frpThreshold;
      document.getElementById("frpThresholdValue").textContent =
        `≥${this.state.frpThreshold} MW`;
      this.map.frpThreshold = this.state.frpThreshold;
      const cel = document.getElementById("frpCount");
      if (cel) cel.textContent = T("ui.eventsOnly", { count: "—" });
      const evidencePref = localStorage.getItem("riskEvidence");
      if (evidencePref !== null)
        this.state.riskEvidenceEnabled = evidencePref !== "0";
      const evidenceCb = document.getElementById("layerRiskEvidence");
      if (evidenceCb) evidenceCb.checked = this.state.riskEvidenceEnabled;
    }
    bindUI() {
      document
        .getElementById("countrySelector")
        .addEventListener("change", (e) =>
          this.countryManager.switchCountry(e.target.value),
        );
      document
        .getElementById("closeDetailBtn")
        .addEventListener("click", () => {
          this.ui.closeDetail(true);
          this.map.clearWindVector();
        });
      document
        .getElementById("baseMapSelect")
        .addEventListener("change", (e) => this.map.setBaseMap(e.target.value));
      document.getElementById("layerFires").addEventListener("change", (e) => {
        this.state.firesEnabled = e.target.checked;
        this.map.toggleFires(e.target.checked);
      });
      document
        .getElementById("layerRiskEvidence")
        ?.addEventListener("change", (e) => {
          this.state.riskEvidenceEnabled = e.target.checked;
          localStorage.setItem(
            "riskEvidence",
            e.target.checked ? "1" : "0",
          );
          if (this.state.riskEvidenceEnabled)
            this.map.showRiskEvidence(
              this.state.selectedPoint?.riskEvidence || null,
            );
          else this.map.clearRiskEvidence();
        });
      document
        .getElementById("layerSentinelSlstr")
        .addEventListener("change", (e) => {
          this.state.slstrEnabled = e.target.checked;
          this.map.toggleSentinelSlstr(e.target.checked);
          this.renderThermalLayers();
          if (
            e.target.checked &&
            A.ThermalSources.getMode() !== "FIRMS_ONLY"
          )
            this.loadThermalSources();
        });
      document
        .getElementById("layerSentinelSlstrA")
        .addEventListener("change", (e) => {
          this.state.slstrAEnabled = e.target.checked;
          this.map.toggleSentinelSlstrSource("sentinel3a-slstr", e.target.checked);
          if (
            e.target.checked &&
            A.ThermalSources.getMode() !== "FIRMS_ONLY"
          )
            this.loadThermalSources();
        });
      document
        .getElementById("layerSentinelSlstrB")
        .addEventListener("change", (e) => {
          this.state.slstrBEnabled = e.target.checked;
          this.map.toggleSentinelSlstrSource("sentinel3b-slstr", e.target.checked);
          if (
            e.target.checked &&
            A.ThermalSources.getMode() !== "FIRMS_ONLY"
          )
            this.loadThermalSources();
        });
      document
        .getElementById("layerMtgFrp")
        .addEventListener("change", (e) => {
          this.state.mtgFrpEnabled = e.target.checked;
          this.map.toggleMtgFrp(e.target.checked);
          this.renderThermalLayers();
          if (
            e.target.checked &&
            A.ThermalSources.registry.isEnabled("mtg-fci-frp")
          )
            this.loadThermalSources();
        });
      document
        .getElementById("layerMultiSensorConf")
        .addEventListener("change", (e) => {
          this.state.multiSensorEnabled = e.target.checked;
          this.map.toggleMultiSensor(e.target.checked);
          this.renderThermalLayers();
          if (e.target.checked) this.rebuildThermalAssociation();
        });
      document
        .getElementById("thermalModeSelect")
        .addEventListener("change", (e) => {
          const mode = A.ThermalSources.setMode(e.target.value);
          this.syncThermalModeUI();
          if (mode === "FIRMS_ONLY") this.clearThermalAlternates();
          else this.loadThermalSources();
        });
      document
        .getElementById("layerFrpHeat")
        .addEventListener("change", (e) => {
          this.state.heatEnabled = e.target.checked;
          this.map.toggleHeat(e.target.checked);
        });
      document.getElementById("frpThreshold").addEventListener("input", (e) => {
        const v = Number(e.target.value);
        this.state.frpThreshold = v;
        document.getElementById("frpThresholdValue").textContent = `≥${v} MW`;
        this.map.frpThreshold = v;
        this.map.renderFires(this.state.selectedTime);
        this.state.fireEvents = this.map.fireEventsVisible;
        this.updateImpact();
        this.renderFireLayers();
        const el = document.getElementById("frpCount");
        if (el)
          el.textContent = T("ui.eventsOnly", {
            count: I.formatNumber(this.state.fireEvents.length),
          });
      });
      document
        .getElementById("layerFireGridImpact")
        .addEventListener("change", (e) => {
          this.state.impactEnabled = e.target.checked;
          this.map.setFireImpacts(this.state.fireImpacts, e.target.checked);
        });
      document
        .getElementById("layerDownwindCorridor")
        .addEventListener("change", (e) => {
          this.state.downwindEnabled = e.target.checked;
          if (e.target.checked) this.loadWindGrid(true);
          else this.map.setDownwindCorridors([], false);
        });
      document.getElementById("layerSmoke").addEventListener("change", (e) => {
        if (e.target.checked) {
          this.state.smokeVariable = "pm10_wildfires";
          this.loadSmokeGrid();
          return;
        }
        this.controllers.air?.abort();
        this.state.smokeVariable = null;
        this.state.smokeData = [];
        this.state.wildfireSummaryData = [];
        this.map.clearSmoke();
        this.ui.updateEnvironmentalKpis([], this.state.windData);
        this.ui.renderExportSummary(this.state);
      });
      document.getElementById("smokeOpacity").addEventListener("input", (e) => {
        const v = Number(e.target.value);
        this.map.smokeLayer?.setOpacity(v);
        document.getElementById("smokeOpacityValue").textContent =
          `%${Math.round(v * 100)}`;
      });
      document.getElementById("layerWind").addEventListener("change", (e) => {
        this.state.windEnabled = e.target.checked;
        this.map.toggleWind(e.target.checked);
        if (e.target.checked) this.loadWindGrid(true);
      });
      document.getElementById("windLevel").addEventListener("change", (e) => {
        this.state.windLevel = e.target.value;
        localStorage.setItem("windLevel", this.state.windLevel);
        this.loadWindGrid(true);
        if (this.state.selectedPoint)
          this.selectPoint(this.state.selectedPoint, true);
      });
      document.getElementById("layerFwi").addEventListener("change", (e) => {
        this.state.fwiEnabled = e.target.checked;
        this.map.toggleFwi(e.target.checked, this.state.selectedTime);
      });
      document
        .getElementById("layerEffisBurntArea")
        .addEventListener("change", (e) => {
          this.state.effisBurntAreaEnabled = e.target.checked;
          this.map.toggleEffisBurntArea(
            e.target.checked,
            this.state.selectedTime,
          );
        });
      document.getElementById("layerMtg").addEventListener("change", (e) => {
        this.state.mtgEnabled = e.target.checked;
        this.map.toggleMtg(e.target.checked, this.state.selectedTime);
      });
      document.getElementById("mtgOpacity").addEventListener("input", (e) => {
        const v = Number(e.target.value) / 100;
        localStorage.setItem("mtgOpacity", String(v));
        this.map.mtgLayer?.setOpacity(v);
        document.getElementById("mtgOpacityValue").textContent =
          `%${Math.round(v * 100)}`;
      });
      document
        .getElementById("layerFootprint")
        .addEventListener("change", (e) => {
          this.map.toggleFootprint(e.target.checked);
          if (e.target.checked && this.state.fireEvents.length)
            this.map.setFootprint(this.state.fireEvents, true);
        });
      document
        .getElementById("layerThermalEnvelope")
        .addEventListener("change", (e) => {
          this.map.toggleThermalEnvelope(e.target.checked);
          if (e.target.checked && this.state.fireEvents.length)
            this.map.setThermalEnvelope(this.state.fireEvents, true);
        });
      document
        .getElementById("layerEventEvolution")
        .addEventListener("change", (e) => {
          this.map.toggleEventEvolution(e.target.checked);
          if (e.target.checked && this.state.fireEvents.length)
            this.map.setEventEvolution(this.state.fireEvents, true);
        });
      document
        .getElementById("layerGridMaster")
        .addEventListener("change", (e) =>
          this.toggleGridMaster(e.target.checked),
        );
      document.querySelectorAll(".gridLayer").forEach((el) =>
        el.addEventListener("change", () => {
          if (this.state.gridMaster) this.refreshGridLayers();
        }),
      );
      document
        .getElementById("timeSlider")
        .addEventListener("input", (e) =>
          this.setTimeOffset(Number(e.target.value), false),
        );
      document
        .getElementById("timeSlider")
        .addEventListener("change", () => this.scheduleTimeReload(0));
      document.getElementById("nowBtn").addEventListener("click", () => {
        document.getElementById("timeSlider").value = "0";
        this.setTimeOffset(0, true);
      });
      document
        .getElementById("stepBackBtn")
        .addEventListener("click", () => this.shiftTime(-3));
      document
        .getElementById("stepForwardBtn")
        .addEventListener("click", () => this.shiftTime(3));
      document
        .getElementById("playBtn")
        .addEventListener("click", () => this.togglePlay());
      document.getElementById("firmsSource").addEventListener("change", (e) => {
        A.FirmsAdapter.setSource(e.target.value);
        A.Cache.clear(`firms:${this.state.countryCode}:`);
        this.loadFirms();
      });
      const autoNote = document.getElementById("firmsSourceNote");
      if (autoNote)
        autoNote.textContent = A.FirmsAdapter.isAuto() ? T("ui.autoFirms") : "";
      document
        .getElementById("healthCheckBtn")
        .addEventListener("click", () => this.healthCheck(true));
      document.getElementById("refreshAllBtn").addEventListener("click", () => {
        A.Cache.clear();
        this.loadSmokeGrid();
        this.loadWindGrid(true);
        if (C.firmsMapKey && C.firmsMapKey !== "__FIRMS_MAP_KEY__")
          this.loadFirms();
        this.ui.toast(T("toast.cacheRefresh"));
      });
      document
        .getElementById("exportCsvBtn")
        .addEventListener("click", () => A.ExportManager.csv(this.state));
      document
        .getElementById("exportJsonBtn")
        .addEventListener("click", () => A.ExportManager.json(this.state));
      document
        .getElementById("exportGeoJsonBtn")
        .addEventListener("click", () => A.ExportManager.geojson(this.state));
    }
    async toggleGridMaster(show) {
      this.state.gridMaster = show;
      document
        .getElementById("gridSublayers")
        .classList.toggle("disabledBlock", !show);
      if (!show) {
        this.map.hideAllGrid();
        return;
      }
      await this.refreshGridLayers();
    }
    async renderGridStaggered() {
      if (!this.state.gridMaster) return;
      const selected = new Set(
        [...document.querySelectorAll(".gridLayer:checked")].map(
          (x) => x.dataset.grid,
        ),
      );
      const order = ["154", "400", "substations"].filter(
        (k) => selected.has(k) && C.gridSources[k],
      );
      if (!order.length) return;
      let delay = 250;
      for (const key of order) {
        await new Promise((r) => setTimeout(r, delay));
        if (
          !this.state.gridMaster ||
          !document.getElementById("layerGridMaster")?.checked
        )
          break;
        if (!document.querySelector(`.gridLayer[data-grid="${key}"]`)?.checked)
          continue;
        try {
          const data = this.grid.data.get(key);
          if (!data) {
            this.ui.toast(T("toast.gridMissing", { layer: key }), "error");
            continue;
          }
          await this.map.setGridGroup(key, data, true);
        } catch (e) {
          this.ui.toast(
            T("toast.gridLayer", { layer: key, error: e.message }),
            "error",
          );
        }
        delay = 200;
      }
    }
    async refreshGridLayers() {
      const selected = new Set(
        [...document.querySelectorAll(".gridLayer:checked")].map(
          (x) => x.dataset.grid,
        ),
      );
      for (const key of Object.keys(C.gridSources)) {
        try {
          if (selected.has(key)) {
            const data = await this.grid.loadGroup(key);
            await this.map.setGridGroup(key, data, true);
          } else if (this.map.gridLayers.has(key)) {
            await this.map.setGridGroup(key, this.grid.data.get(key), false);
          }
        } catch (e) {
          this.ui.toast(
            T("toast.gridLayer", { layer: key, error: e.message }),
            "error",
          );
        }
      }
    }
    setTimeOffset(hours, reload) {
      const d = new Date(Date.now() + hours * 3600e3);
      if (this.state.mtgEnabled) d.setUTCSeconds(0, 0);
      else d.setUTCMinutes(0, 0, 0);
      this.state.selectedTime = d;
      this.ui.setTime(d);
      this.map.renderFires(d);
      this.state.fireEvents = this.map.fireEventsVisible;
      if (this.state.heatEnabled) this.map.toggleHeat(true);
      if (this.state.fwiEnabled) this.map.toggleFwi(true, d);
      if (this.state.effisBurntAreaEnabled)
        this.map.toggleEffisBurntArea(true, d);
      if (this.state.mtgEnabled) this.map.setMtgTime(d);
      this.updateImpact();
      this.ui.renderExportSummary(this.state);
      this.renderFireLayers();
      if (!this.playTimer) this.scheduleThermalReload(reload ? 0 : 400);
      if (reload) this.scheduleTimeReload(0);
      else this.scheduleTimeReload(300);
    }
    shiftTime(delta) {
      const s = document.getElementById("timeSlider"),
        v = U.clamp(Number(s.value) + delta, Number(s.min), Number(s.max));
      s.value = String(v);
      this.setTimeOffset(v, true);
    }
    togglePlay() {
      const b = document.getElementById("playBtn");
      if (this.playTimer) {
        clearInterval(this.playTimer);
        this.playTimer = null;
        b.textContent = "▶";
        this.scheduleThermalReload(0);
        return;
      }
      b.textContent = "⏸";
      this._playbackApiThrottle = 0;
      this.scheduleThermalReload(600);
      this.playTimer = setInterval(() => {
        const s = document.getElementById("timeSlider");
        const step = this.state.mtgEnabled
          ? C.timeline.mtgPlayStepMinutes / 60
          : C.timeline.playStepHours;
        let v = Number(s.value) + step;
        if (v > Number(s.max)) v = Number(s.min);
        s.value = String(v);
        const now = Date.now();
        const slowReload =
          now - this._playbackApiThrottle > C.timeline.playIntervalMs * 4;
        this.setTimeOffset(v, slowReload);
        if (slowReload) this._playbackApiThrottle = now;
      }, C.timeline.playIntervalMs);
    }
    scheduleTimeReload(ms) {
      clearTimeout(this.timeTimer);
      this.timeTimer = setTimeout(() => {
        this.loadSmokeGrid();
        this.loadWindGrid(true);
        if (this.state.selectedPoint)
          this.selectPoint(this.state.selectedPoint, true);
      }, ms);
    }
    async loadSmokeGrid() {
      if (!this.state.smokeVariable) return;
      this.controllers.air?.abort();
      const ctrl = new AbortController();
      this.controllers.air = ctrl;
      const seq = ++this.reqSeq.air,
        countryCode = this.state.countryCode,
        pts = U.adaptiveGrid(this.map.bounds(), this.map.zoom(), 120),
        variable = this.state.smokeVariable;
      if (!pts.length) {
        this.state.smokeData = [];
        this.state.wildfireSummaryData = [];
        this.map.clearSmoke();
        this.ui.setNearestNote(
          T("ui.smokeOutside", { country: I.countryName(countryCode) }),
        );
        this.ui.updateEnvironmentalKpis([], this.state.windData);
        return;
      }
      try {
        const selected = await A.OpenMeteoAir.grid(
          pts,
          variable,
          this.state.selectedTime,
          ctrl.signal,
        );
        if (seq !== this.reqSeq.air || countryCode !== this.state.countryCode)
          return;
        this.state.smokeData = selected;
        this.state.wildfireSummaryData = selected;
        this.map.setSmoke(selected, variable);
        const nearest = selected.find((x) => x.validAt)?.validAt;
        this.ui.setNearestNote(
          nearest
            ? T("ui.smokeTime", {
                time: U.formatUtc(new Date(nearest)),
                country: I.countryName(countryCode),
                count: I.formatNumber(selected.length),
              })
            : T("ui.smokeEmpty"),
        );
        this.ui.updateEnvironmentalKpis(
          this.state.wildfireSummaryData,
          this.state.windData,
        );
        this.ui.renderExportSummary(this.state);
        this.ui.setUpdated();
      } catch (e) {
        if (e.kind !== "ABORTED" && countryCode === this.state.countryCode)
          this.ui.toast(
            T("toast.smoke", { error: e.kind || e.message }),
            "error",
          );
      }
    }
    async loadWindGrid(force = false) {
      if (!force && !this.state.windEnabled && !this.state.downwindEnabled)
        return;
      this.controllers.wind?.abort();
      const ctrl = new AbortController();
      this.controllers.wind = ctrl;
      const seq = ++this.reqSeq.wind,
        countryCode = this.state.countryCode,
        pts = U.adaptiveGrid(
          this.map.bounds(),
          Math.max(2, this.map.zoom() - 1),
          25,
        );
      if (!pts.length) {
        this.state.windData = [];
        this.state.surfaceWindData = [];
        this.map.surfaceWindData = [];
        this.map.setWind([], this.state.windLevel);
        this.updateImpact();
        this.ui.updateEnvironmentalKpis(this.state.wildfireSummaryData, []);
        return;
      }
      try {
        const data = await A.OpenMeteoWeather.grid(
          pts,
          this.state.selectedTime,
          this.state.windLevel,
          ctrl.signal,
        );
        if (seq !== this.reqSeq.wind || countryCode !== this.state.countryCode)
          return;
        this.state.windData = data;
        this.map.setWind(data, this.state.windLevel);
        this.map.toggleWind(this.state.windEnabled);
        let surface = data;
        if (this.state.windLevel !== "10m") {
          surface = await A.OpenMeteoWeather.grid(
            pts,
            this.state.selectedTime,
            "10m",
            ctrl.signal,
          );
          if (
            seq !== this.reqSeq.wind ||
            countryCode !== this.state.countryCode
          )
            return;
        }
        this.state.surfaceWindData = surface;
        this.map.surfaceWindData = surface;
        this.updateImpact();
        this.ui.updateEnvironmentalKpis(
          this.state.wildfireSummaryData,
          this.state.windData,
        );
        this.ui.renderExportSummary(this.state);
      } catch (e) {
        if (e.kind !== "ABORTED" && countryCode === this.state.countryCode)
          this.ui.toast(
            T("toast.wind", { error: e.kind || e.message }),
            "error",
          );
      }
    }
    async loadFirms() {
      this.controllers.firms?.abort();
      const ctrl = new AbortController();
      this.controllers.firms = ctrl;
      const seq = ++this.reqSeq.firms,
        countryCode = this.state.countryCode;
      try {
        const data = await A.FirmsAdapter.load(ctrl.signal, {
          visibleWindow: this.state.selectedTime,
        });
        if (seq !== this.reqSeq.firms || countryCode !== this.state.countryCode)
          return;
        this.state.fireData = data.filter(
          (f) => f.countryCode === countryCode && U.insideRegion(f),
        );
        this.map.setFires(this.state.fireData, this.state.selectedTime);
        this.map.toggleFires(this.state.firesEnabled);
        this.state.fireEvents = this.map.fireEventsVisible;
        if (this.state.heatEnabled) this.map.toggleHeat(true);
        this.updateImpact();
        this.ui.renderExportSummary(this.state);
        this.ui.setUpdated();
        this.renderFireLayers();
        this.rebuildThermalAssociation();
      } catch (e) {
        if (e.kind === "ABORTED" || countryCode !== this.state.countryCode)
          return;
        if (e.kind === "AUTH_REQUIRED") {
          document.getElementById("kpiFireEvents").textContent = "KEY";
          document.getElementById("kpiDetectionsNote").textContent =
            "NASA FIRMS MAP_KEY";
          this.ui.toast(T("toast.firmsAuth"), "warn");
          return;
        }
        this.ui.toast(`FIRMS: ${e.kind || e.message}`, "warn");
      }
    }
    async loadThermalSources() {
      if (A.ThermalSources.getMode() === "FIRMS_ONLY") return;
      const TS = A.ThermalSources;
      const plan = TS.planThermalRequests({
        mode: TS.getMode(),
        sentinel3a: this.state.slstrAEnabled,
        sentinel3b: this.state.slstrBEnabled,
      });
      if (!plan.slstrIds.length && !plan.mtg) return;
      this.controllers.thermal?.abort();
      const ctrl = new AbortController();
      this.controllers.thermal = ctrl;
      const seq = ++this.reqSeq.thermal,
        countryCode = this.state.countryCode;
      const request = {
        bbox: [A.CONFIG.regionBounds.west, A.CONFIG.regionBounds.south, A.CONFIG.regionBounds.east, A.CONFIG.regionBounds.north],
        countryCode,
        startTime: new Date(this.state.selectedTime.getTime() - 24 * 3600e3),
        endTime: this.state.selectedTime,
        signal: ctrl.signal,
      };
      const tasks = [];
      if (plan.slstrIds.length)
        tasks.push(
          TS.loadSlstrGroup(request, plan.slstrIds).then((r) => ({
            group: "slstr",
            result: r,
          })),
        );
      if (plan.mtg) {
        TS.setLoading("mtg-fci-frp", seq);
        tasks.push(
          TS.registry
            .load("mtg-fci-frp", request)
            .then(
              (data) => {
          TS.setResult(
            "mtg-fci-frp",
            seq,
            data || [],
            request.latency,
            request.requestKey,
            { visibleWindow: this.state.selectedTime },
          );
                return {
                  group: "mtg",
                  result: {
                    status: data && data.length ? "ok" : "empty",
                    data: data || [],
                    merged: data || [],
                  },
                };
              },
              (e) => {
                const aborted = e && e.kind === "ABORTED";
                if (!aborted) TS.setError("mtg-fci-frp", seq, e);
                return {
                  group: "mtg",
                  result: {
                    status: aborted ? "aborted" : "error",
                    data: null,
                    merged: [],
                    error: String((e && e.message) || e),
                  },
                };
              },
            ),
        );
      }
      const settled = await Promise.all(tasks);
      if (seq !== this.reqSeq.thermal || countryCode !== this.state.countryCode)
        return;
      let slstrGroupRes = null,
        mtgRes = null;
      for (const t of settled) {
        if (t.group === "slstr") slstrGroupRes = t.result;
        else mtgRes = t.result;
      }
      if (slstrGroupRes) {
        this.state.slstrStatus = slstrGroupRes.status;
        this.state.slstrData = slstrGroupRes.merged;
        const counts = {};
        for (const s of slstrGroupRes.bySource)
          counts[s.id] = s.data?.length ?? 0;
        for (const s of slstrGroupRes.bySource)
          this.map.setSlstrSource(s.id, s.data, this.state.selectedTime);
        this.map.setSlstr(slstrGroupRes.merged, this.state.selectedTime);
        const statusEl = document.getElementById("sentinelSlstrStatus");
        if (statusEl) {
          const key = A.ThermalSources.orchestratorStatusKey(
            slstrGroupRes.status,
          );
          if (key)
            statusEl.textContent = T(key, {
              a: counts["sentinel3a-slstr"] ?? 0,
              b: counts["sentinel3b-slstr"] ?? 0,
            });
        }
        if (this.state.slstrEnabled) {
          this.map.toggleSentinelSlstr(true);
          this.map.toggleSentinelSlstrSource("sentinel3a-slstr", this.state.slstrAEnabled);
          this.map.toggleSentinelSlstrSource("sentinel3b-slstr", this.state.slstrBEnabled);
        }
      }
      if (mtgRes) {
        this.state.mtgFrpData = mtgRes.merged;
        this.map.setMtgFrp(mtgRes.merged, this.state.selectedTime);
        if (this.state.mtgFrpEnabled) this.map.toggleMtgFrp(true);
      }
      this.renderThermalLayers();
      this.rebuildThermalAssociation();
    }
    rebuildThermalAssociation() {
      if (A.ThermalSources.getMode() !== "MULTI_SOURCE") return;
      if (!A.CONFIG.thermalFusion?.enabled || !A.ThermalAssociation) return;
      const bySource = A.ThermalSources.associationSources({
        fireData: this.state.fireData || [],
        slstrData: this.state.slstrData || [],
        mtgFrpData: this.state.mtgFrpData || [],
      });
      const events = A.ThermalAssociation.associateAcrossSources({ bySource });
      this.state.multiSensorEvents = events;
      const ms = A.ThermalSources.computeMultiSensorMetrics(events);
      A.ThermalSources.patchState("multi-sensor", {
        status: events.length ? "ok" : "empty",
        data: events,
        error: null,
        lastSuccessfulAt: events.length
          ? new Date().toISOString()
          : (A.ThermalSources.state("multi-sensor").lastSuccessfulAt ?? null),
        latency: null,
        count: events.length,
        metrics: {
          ...ms.metrics,
          totalMatchedEvents: ms.totalMatchedEvents,
          twoFamilyEvents: ms.twoFamilyEvents,
          threePlusFamilyEvents: ms.threePlusFamilyEvents,
          familiesUsed: ms.familiesUsed,
          confirmedByProduct: ms.confirmedByProduct,
          confirmedBySource: ms.confirmedBySource,
        },
        lastErrorAt: null,
      });
      this.map.setMultiSensor(events, this.state.selectedTime);
      if (this.state.multiSensorEnabled) this.map.toggleMultiSensor(true);
    }
    scheduleThermalReload(ms) {
      if (A.ThermalSources.getMode() === "FIRMS_ONLY") return;
      const key = A.ThermalSources.thermalWindowKey(
        this.state.countryCode,
        this.state.selectedTime,
      );
      if (key === this._thermalWindowKey) return;
      this._thermalWindowKey = key;
      clearTimeout(this.thermalTimer);
      this.thermalTimer = setTimeout(
        () => this.loadThermalSources(),
        ms == null ? 400 : ms,
      );
    }
    renderThermalLayers() {
      if (!this.map) return;
      const st = this.state;
      if (st.slstrEnabled) {
        this.map.toggleSentinelSlstr(true);
        this.map.toggleSentinelSlstrSource("sentinel3a-slstr", st.slstrAEnabled);
        this.map.toggleSentinelSlstrSource("sentinel3b-slstr", st.slstrBEnabled);
      } else this.map.toggleSentinelSlstr(false);
      if (st.mtgFrpEnabled) this.map.toggleMtgFrp(true);
      else this.map.toggleMtgFrp(false);
      if (st.multiSensorEnabled) this.map.toggleMultiSensor(true);
      else this.map.toggleMultiSensor(false);
    }
    syncThermalModeUI() {
      const mode = A.ThermalSources.getMode(),
        alternate = mode !== "FIRMS_ONLY",
        fusion = mode === "MULTI_SOURCE";
      const sentinel = document.getElementById("layerSentinelSlstr"),
        sentinelLabel = sentinel?.closest("label"),
        sentinelDeps = document.querySelector(
          '[data-depends-on="layerSentinelSlstr"]',
        ),
        mtgLabel = document.getElementById("layerMtgFrp")?.closest("label"),
        multiLabel = document
          .getElementById("layerMultiSensorConf")
          ?.closest("label");
      for (const el of [sentinelLabel, sentinelDeps])
        if (el) el.hidden = !alternate;
      if (multiLabel) multiLabel.hidden = !fusion;
      if (mtgLabel && !alternate) mtgLabel.hidden = true;
      if (!alternate) {
        this.state.slstrEnabled = false;
        this.state.slstrAEnabled = false;
        this.state.slstrBEnabled = false;
        this.state.mtgFrpEnabled = false;
        if (this.map) {
          this.map.toggleSentinelSlstr(false);
          this.map.toggleMtgFrp(false);
        }
      }
      if (!fusion) {
        this.state.multiSensorEnabled = false;
        if (this.map) this.map.toggleMultiSensor(false);
      }
      this.ui?.syncLayerDependents?.();
    }
    clearThermalAlternates() {
      this.state.slstrData = [];
      this.state.slstrStatus = "idle";
      this.state.mtgFrpData = [];
      this.state.multiSensorEvents = [];
      A.ThermalSources.patchState("multi-sensor", {
        status: "disabled",
        data: [],
        error: null,
        count: 0,
        metrics: A.ThermalSources.defaultMetrics(),
        lastErrorAt: null,
      });
      if (this.map) {
        this.map.setSlstr([], this.state.selectedTime);
        this.map.setSlstrSource("sentinel3a-slstr", [], this.state.selectedTime);
        this.map.setSlstrSource("sentinel3b-slstr", [], this.state.selectedTime);
        this.map.setMtgFrp([], this.state.selectedTime);
        this.map.setMultiSensor([], this.state.selectedTime);
        this.renderThermalLayers();
      }
      const statusEl = document.getElementById("sentinelSlstrStatus");
      if (statusEl) statusEl.textContent = T("thermal.orchestrator.none");
    }
    renderFireLayers() {
      const ev = this.state.fireEvents;
      if (document.getElementById("layerFootprint")?.checked)
        this.map.setFootprint(ev, true);
      if (document.getElementById("layerThermalEnvelope")?.checked)
        this.map.setThermalEnvelope(ev, true);
      if (document.getElementById("layerEventEvolution")?.checked)
        this.map.setEventEvolution(ev, true);
    }
    updateImpact() {
      if (!this.grid.loadedCore) return;
      this.state.fireEvents = (this.map.fireEventsVisible || []).filter(
        (event) => event.countryCode === this.state.countryCode,
      );
      this.state.fireImpacts = this.grid.analyzeEvents(
        this.state.fireEvents,
        25,
        this.state.selectedTime,
        this.state.surfaceWindData,
      );
      this.map.setFireImpacts(this.state.fireImpacts, this.state.impactEnabled);
      this.map.setDownwindCorridors(
        this.state.fireImpacts,
        this.state.downwindEnabled,
      );
      this.ui.renderImpact(this.state.fireImpacts);
      this.ui.renderExportSummary(this.state);
      this.syncSelectedRiskEvidence();
    }
    syncSelectedRiskEvidence() {
      const sp = this.state.selectedPoint;
      if (!sp) return;
      let ev = sp.riskEvidence || null;
      if (
        ev &&
        !(this.state.fireImpacts || []).some(
          (a) => a.evidence?.lineId === ev.lineId,
        )
      )
        ev = null;
      this.state.selectedPoint = { ...sp, riskEvidence: ev };
      if (this.state.riskEvidenceEnabled) this.map.showRiskEvidence(ev);
      else this.map.clearRiskEvidence();
    }
    async selectPoint(p, silent = false) {
      if (!U.insideRegion(p)) {
        if (!silent)
          this.ui.openDetail(
            T("ui.outsideTitle", {
              country: I.countryName(this.state.countryCode),
            }),
            `<div class="warningBox">${T("ui.outsideBody", { coverage: U.escapeHtml(I.countryCoverage(this.state.countryCode)) })}</div>`,
          );
        return;
      }
      p = { ...p, lat: Number(p.lat), lon: Number(p.lon) };
      let riskEvidence = p.riskEvidence || null;
      if (!riskEvidence && p.gridFeature?.kind === "line") {
        const key = this.grid.assetKey(
          p.gridFeature.properties || {},
          `line-${p.gridFeature.group || ""}`,
        );
        const rows = (this.state.fireImpacts || []).filter(
          (a) => a.evidence?.lineId === key,
        );
        if (rows.length)
          riskEvidence = rows.sort(
            (x, y) => (y.riskScore || 0) - (x.riskScore || 0),
          )[0].evidence;
      }
      this.state.selectedPoint = {
        lat: p.lat,
        lon: p.lon,
        fire: p.fire,
        fireEvent: p.fireEvent,
        gridFeature: p.gridFeature,
        riskEvidence,
      };
      if (this.state.riskEvidenceEnabled) this.map.showRiskEvidence(riskEvidence);
      else this.map.clearRiskEvidence();
      this.controllers.detail?.abort();
      const ctrl = new AbortController();
      this.controllers.detail = ctrl;
      const seq = ++this.reqSeq.detail,
        countryCode = this.state.countryCode;
      if (!silent)
        this.ui.openDetail(
          p.fireEvent
            ? T("analysis.fireEvent")
            : p.fire
              ? "FIRMS"
              : p.gridFeature
                ? T("detail.gridAssetBadge")
                : T("detail.loadingTitle"),
          `<div class="emptyState">${T("detail.loadingBody")}</div>`,
        );
      try {
        if (!this.grid.loadedCore)
          await this.grid.loadCore(this.state.countryAbortController?.signal);
        const [airResult, weatherResult] = await Promise.allSettled([
          A.OpenMeteoAir.detail(p, this.state.selectedTime, ctrl.signal),
          A.OpenMeteoWeather.detail(p, this.state.selectedTime, ctrl.signal),
        ]);
        if (
          seq !== this.reqSeq.detail ||
          countryCode !== this.state.countryCode
        )
          return;
        const air = airResult.status === "fulfilled" ? airResult.value : null;
        const weather =
          weatherResult.status === "fulfilled" ? weatherResult.value : null;
        if (!air && !weather) {
          if (!silent)
            this.ui.openDetail(
              T("detail.noDataTitle"),
              `<div class="warningBox">${T("detail.noDataBody")}</div>`,
            );
          return;
        }
        const end = Math.min(
            this.state.selectedTime.getTime(),
            Date.now() + 15 * 60e3,
          ),
          start = end - 24 * 3600e3,
          nearby = (this.state.fireData || [])
            .filter((f) => f.countryCode === countryCode)
            .filter((f) => {
              const t = Date.parse(f.detectedAt);
              return t >= start && t <= end;
            })
            .map((f) => ({
              fire: f,
              distance: U.haversineKm(
                { lat: p.lat, lon: p.lon },
                { lat: f.lat, lon: f.lon },
              ),
            }))
            .filter((x) => x.distance <= C.NEARBY_FIRMS_RADIUS_KM)
            .sort((a, b) => a.distance - b.distance),
          nearest = this.grid.nearest({ lat: p.lat, lon: p.lon }, 50),
          ah = U.areaHistory(
            this.map.fireAll,
            { lat: p.lat, lon: p.lon },
            C.fireClustering.radiusKm,
          );
        this.ui.renderPointDetail(
          p,
          air,
          weather,
          nearby,
          ah,
          p.fire,
          p.fireEvent,
          p.gridFeature,
          nearest,
          riskEvidence,
        );
        if (weather) {
          const lvl = C.windLevels[this.state.windLevel] || C.windLevels["10m"];
          this.map.drawWindVector(
            { lat: p.lat, lon: p.lon },
            weather.values[lvl.direction],
            weather.values[lvl.speed],
            this.state.windLevel,
            weather.validAt,
          );
        }
        this.ui.renderExportSummary(this.state);
      } catch (e) {
        if (e.kind !== "ABORTED" && countryCode === this.state.countryCode)
          this.ui.openDetail(
            T("detail.noDataTitle"),
            `<div class="warningBox">${U.escapeHtml(e.kind || e.message)}. ${T("detail.noDataBody")}</div>`,
          );
      }
    }
    async healthCheck(showToast = true) {
      const country = A.activeCountry(),
        countryCode = this.state.countryCode,
        name = I.countryName(countryCode),
        manifest = this.state.countryManifest || {};
      A.Events.emit("service", {
        id: "grid",
        state: manifest.partial ? "warn" : this.grid.loadedCore ? "ok" : "idle",
        count: manifest.rawFeatureCount,
        note: manifest.partial
          ? T("ui.gridPartial", { count: manifest.failedRequests || 0 })
          : this.grid.loadedCore
            ? T("ui.gridReady", { country: name })
            : T("ui.gridGeoLoading", { country: name }),
      });
      if (!C.firmsMapKey || C.firmsMapKey === "__FIRMS_MAP_KEY__")
        A.Events.emit("service", {
          id: "firms",
          state: "warn",
          note: T("ui.firmsNoCall", { country: name }),
        });
      this.controllers.health?.abort();
      const ctrl = new AbortController();
      this.controllers.health = ctrl;
      const seq = ++this.reqSeq.health;
      await Promise.allSettled([
        A.OpenMeteoAir.health(ctrl.signal),
        A.OpenMeteoWeather.health(ctrl.signal),
      ]);
      if (seq !== this.reqSeq.health || countryCode !== this.state.countryCode)
        return;
      A.Events.emit("service", {
        id: "effis",
        state: "idle",
        note: T("ui.effisIdle", { country: name }),
      });
      A.Events.emit("service", {
        id: "effisBurntArea",
        state: "idle",
        note: T("ui.effisBurntIdle", { country: name }),
      });
      A.Events.emit("service", {
        id: "mtg",
        state: "idle",
        note: T("ui.mtgIdle", { country: name }),
      });
      if (showToast) this.ui.toast(T("toast.healthDone", { country: name }));
    }
  }
  A.app = new Application();
  window.addEventListener("DOMContentLoaded", () => A.app.init());
})(window.AtmoApp);
