(function (A) {
  const U = A.Utils,
    C = A.CONFIG,
    I = A.I18n,
    T = (key, params) => I.t(key, params);
  class UIManager {
    constructor() {
      this.services = {
        basemap: { nameKey: "service.basemap", state: "idle" },
        firms: { name: "NASA FIRMS", state: "idle" },
        air: { name: "CAMS Wildfire PM10", state: "idle" },
        weather: { name: "Open-Meteo Weather", state: "idle" },
        effis: { name: "Copernicus EFFIS FWI", state: "idle" },
        effisBurntArea: { nameKey: "service.effisBurnt", state: "idle" },
        mtg: { name: "EUMETSAT MTG GeoColour", state: "idle" },
        grid: { nameKey: "service.grid", state: "idle" },
        geocode: { name: "Geocoding", state: "idle" },
      };
      this.chart = null;
      this.sortKey = null;
      this.sortDir = 1;
      this.pendingDetail = { title: "", html: "" };
      this.lastMtgToast = null;
      this.detailSwipeStart = null;
      this.lastMtgFrame = null;
    }
    init() {
      I.applyDocument();
      document
        .querySelectorAll(".navBtn")
        .forEach((b) =>
          b.addEventListener("click", () => this.showView(b.dataset.view)),
        );
      const layerBody = document.getElementById("layerPanelBody");
      this.syncLayerPanelPlacement();
      document.querySelector(".collapseBtn")?.addEventListener("click", (e) => {
        layerBody.classList.toggle("hidden");
        e.currentTarget.textContent = layerBody.classList.contains("hidden")
          ? "+"
          : "−";
        if (document.getElementById("view-map")?.classList.contains("active"))
          setTimeout(() => A.app?.map?.map?.invalidateSize(), 30);
      });
      document.querySelectorAll(".layerGroupToggle").forEach((btn) =>
        btn.addEventListener("click", () => {
          const group = btn.closest(".layerGroup"),
            open = !group.classList.contains("accordionOpen");
          group.classList.toggle("accordionOpen", open);
          btn.setAttribute("aria-expanded", String(open));
        }),
      );
      document
        .querySelectorAll(".layerDependent[data-depends-on]")
        .forEach((el) => {
          const input = document.getElementById(el.dataset.dependsOn);
          if (input)
            input.addEventListener("change", () => this.syncLayerDependents());
        });
      this.syncLayerDependents();
      document
        .getElementById("brandHomeLink")
        ?.addEventListener("click", (e) => {
          e.preventDefault();
          this.showView("map");
          this.closeDetail(true);
          this.setLegendOpen(false);
          this.setAnalysisOpen(false);
          A.app?.map?.clearWindVector?.();
        });
      document
        .getElementById("languageSelector")
        ?.addEventListener("change", (e) => I.setLanguage(e.target.value));
      I.onChange(() => this.applyLanguage());
      document
        .getElementById("miniCardDetailBtn")
        ?.addEventListener("click", () => this.openFullDetail());
      document
        .getElementById("miniCardCloseBtn")
        ?.addEventListener("click", () => this.closeDetail(true));
      document
        .getElementById("detailBackdrop")
        ?.addEventListener("click", () => this.closeDetail(true));
      const detailPanel = document.getElementById("detailPanel");
      detailPanel?.addEventListener("pointerdown", (e) => {
        if (this.isMobileMap()) this.detailSwipeStart = e.clientY;
      });
      detailPanel?.addEventListener("pointerup", (e) => {
        if (
          this.detailSwipeStart != null &&
          e.clientY - this.detailSwipeStart > 50
        )
          this.closeDetail(true);
        this.detailSwipeStart = null;
      });
      const legendBtn = document.getElementById("legendToggleBtn"),
        legendStack = document.getElementById("legendStack"),
        analysisBtn = document.getElementById("analysisToggle"),
        analysisPanel = document.getElementById("analysisSummaryPanel");
      legendBtn?.addEventListener("click", () => {
        const willOpen = legendStack.classList.contains("legendsHidden");
        if (willOpen) this.setAnalysisOpen(false);
        this.setLegendOpen(willOpen);
        if (willOpen) this.holdLayerPanel(true);
      });
      analysisBtn?.addEventListener("click", () => {
        const willOpen = analysisPanel.classList.contains("analysisHidden");
        if (willOpen) this.setLegendOpen(false);
        this.setAnalysisOpen(willOpen);
        if (willOpen) this.holdLayerPanel(true);
      });
      document
        .getElementById("analysisClose")
        ?.addEventListener("click", () => this.setAnalysisOpen(false));
      this.initQuickLayers();
      const requiredUniqueIds = [
        "analysisToggle",
        "analysisSummaryPanel",
        "analysisClose",
        "analysisSummaryBody",
      ];
      for (const id of requiredUniqueIds) {
        const nodes = document.querySelectorAll(`#${id}`);
        if (nodes.length !== 1)
          console.error(`DOM contract violation: #${id} count=${nodes.length}`);
      }
      A.Events.on("service", (s) => {
        this.updateService(s);
        this.syncQuickLayers();
      });
      A.Events.on("mtgFrame", (x) => this.updateMtgTimeBadge(x));
      A.Events.on("firesRendered", (x) => {
        document.getElementById("kpiFireEvents").textContent = I.formatNumber(
          x.events ?? 0,
        );
        document.getElementById("kpiDetectionsNote").textContent = T(
          "kpi.detections",
          { count: I.formatNumber(x.detections ?? 0) },
        );
        const el = document.getElementById("frpCount");
        if (el)
          el.textContent = T("kpi.eventsShown", {
            shown: I.formatNumber(x.events ?? 0),
            total: I.formatNumber(x.eventsTotal ?? x.events ?? 0),
          });
      });
      A.Events.on("gridCoreReady", (s) => this.renderGridSummary(s));
      this.renderServices();
      this.applyLanguage();
      document.querySelectorAll("#impactTable th[data-sort]").forEach((th) =>
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (this.sortKey === key) this.sortDir *= -1;
          else {
            this.sortKey = key;
            this.sortDir = 1;
          }
          if (A.app?.state?.fireImpacts)
            this.renderImpact(A.app.state.fireImpacts);
        }),
      );
    }
    setCountryLoading(country) {
      for (const id of [
        "kpiFireEvents",
        "kpiCriticalEvents",
        "kpiRiskLines",
        "kpiRiskSubstations",
        "kpiWildfirePm10",
        "kpiWind",
      ]) {
        const el = document.getElementById(id);
        if (el) el.textContent = "…";
      }
      document.getElementById("impactTableBody").innerHTML =
        `<tr><td colspan="8">${T("ui.countryLoading")}</td></tr>`;
      document.getElementById("analysisSummaryBody").innerHTML =
        `<div class="emptyState">${T("ui.countryLoading")}</div>`;
      this.closeDetail(true);
      document.getElementById("detailTitle").textContent =
        T("detail.pickTitle");
      document.getElementById("detailContent").textContent =
        T("detail.pickBody");
      this.updateService({
        id: "grid",
        state: "loading",
        note: T("ui.gridLoading", { country: I.countryName(country.code) }),
      });
      this.syncQuickLayers();
    }
    setCountry(country, manifest) {
      const name = I.countryName(country.code),
        coverage = I.countryCoverage(country.code),
        domain = document.getElementById("domainPill");
      if (domain) domain.textContent = T("status.dataFor", { country: name });
      const home = document.getElementById("brandHomeLink");
      if (home) home.href = I.url(country.code);
      const hint = document.getElementById("countryCoverageHint");
      if (hint) hint.textContent = T("layers.coverage", { coverage });
      const note = document.getElementById("countryCoverageNote");
      if (note) note.textContent = coverage;
      const analysis = document.getElementById("analysisSummaryBody");
      if (analysis && !A.app?.state?.fireImpacts?.length)
        analysis.innerHTML = `<div class="emptyState">${T("ui.noActiveRisk")}</div>`;
      const partial = manifest?.partial;
      this.updateService({
        id: "grid",
        state: partial ? "warn" : manifest ? "ok" : "idle",
        count: manifest?.rawFeatureCount,
        note: partial
          ? T("ui.gridPartial", { count: manifest.failedRequests || 0 })
          : manifest
            ? T("ui.gridConnected", {
                count: I.formatNumber(manifest.rawFeatureCount || 0),
              })
            : "",
      });
      this.setTime(A.app?.state?.selectedTime || new Date());
      this.renderServices();
    }
    showView(view) {
      this.closeQuickLayers();
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
      document
        .querySelectorAll(".navBtn")
        .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
      if (view === "map")
        setTimeout(() => A.app?.map?.map?.invalidateSize(), 30);
    }
    isMobileMap() {
      return window.matchMedia(
        "(max-width:760px), (max-height:500px) and (orientation:landscape)",
      ).matches;
    }
    initQuickLayers() {
      const fab = document.getElementById("quickLayersFab"),
        pop = document.getElementById("quickLayersPopover");
      if (!fab || !pop) return;
      fab.addEventListener("click", () => this.toggleQuickLayers());
      pop.querySelectorAll(".quickLayerBtn").forEach((btn) =>
        btn.addEventListener("click", () =>
          this.toggleQuickLayer(btn.dataset.quickLayer),
        ),
      );
      document.getElementById("quickLayersAll")?.addEventListener("click", (e) => {
        e.preventDefault();
        this.closeQuickLayers();
        this.showView("settings");
        setTimeout(
          () =>
            document
              .getElementById("mobileLayerSettings")
              ?.scrollIntoView({ behavior: "smooth", block: "start" }),
          60,
        );
      });
      document.addEventListener("pointerdown", (e) => {
        if (pop.classList.contains("hidden")) return;
        if (!pop.contains(e.target) && !fab.contains(e.target))
          this.closeQuickLayers();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.closeQuickLayers();
      });
      window.addEventListener("popstate", () => this.closeQuickLayers());
      document
        .getElementById("countrySelector")
        ?.addEventListener("change", () => this.closeQuickLayers());
      document.addEventListener("change", (e) => {
        if (
          ["layerMtg", "layerFrpHeat", "layerSmoke", "layerGridMaster"].includes(
            e.target.id,
          )
        )
          this.syncQuickLayers();
      });
      window.addEventListener("resize", () => this.closeQuickLayers());
      window.addEventListener("orientationchange", () =>
        this.closeQuickLayers(),
      );
      this.syncQuickLayers();
    }
    toggleQuickLayers() {
      const pop = document.getElementById("quickLayersPopover"),
        fab = document.getElementById("quickLayersFab");
      if (!pop) return;
      if (!pop.classList.contains("hidden")) {
        this.closeQuickLayers();
        return;
      }
      pop.classList.remove("hidden");
      fab?.setAttribute("aria-expanded", "true");
    }
    closeQuickLayers() {
      const pop = document.getElementById("quickLayersPopover"),
        fab = document.getElementById("quickLayersFab");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(document.activeElement))
        fab?.focus({ preventScroll: true });
      pop.classList.add("hidden");
      fab?.setAttribute("aria-expanded", "false");
    }
    toggleQuickLayer(id) {
      const input = document.getElementById(id);
      if (!input || input.disabled) return;
      input.click();
    }
    syncQuickLayers() {
      const warningStates = new Set(["error", "warn", "stale", "partial"]);
      const loading = {
        layerMtg: this.services.mtg?.state === "loading",
        layerSmoke: this.services.air?.state === "loading",
        layerGridMaster:
          this.services.grid?.state === "loading" ||
          Boolean(A.app?.grid?.loading?.size),
      };
      const warn = {
        layerMtg: warningStates.has(this.services.mtg?.state),
        layerSmoke: warningStates.has(this.services.air?.state),
        layerFrpHeat: warningStates.has(this.services.firms?.state),
        layerGridMaster: warningStates.has(this.services.grid?.state),
      };
      for (const btn of document.querySelectorAll(".quickLayerBtn")) {
        const input = document.getElementById(btn.dataset.quickLayer);
        if (!input) continue;
        const active = input.checked,
          key = btn.dataset.quickLayer,
          isWarn = Boolean(warn[key]);
        btn.classList.toggle("active", active);
        btn.classList.toggle("loading", active && Boolean(loading[key]));
        btn.classList.toggle("warn", isWarn && !loading[key]);
        btn.setAttribute("aria-pressed", String(active));
        const label = btn.querySelector(".qlLabel")?.textContent?.trim() || "";
        let aria = label;
        if (active && loading[key]) aria = `${label} — ${T("quickLayers.loading")}`;
        else if (isWarn) aria = `${label} — ${T("quickLayers.warning")}`;
        btn.setAttribute("aria-label", aria);
      }
    }
    syncLayerPanelPlacement() {
      const panel = document.querySelector(".layerPanel"),
        body = document.getElementById("layerPanelBody"),
        mobileTarget = document.getElementById("mobileLayerSettingsBody"),
        mobile = this.isMobileMap(),
        target = mobile ? mobileTarget : panel;
      if (!panel || !body || !target) return;
      if (body.parentElement !== target) target.appendChild(body);
      panel.toggleAttribute("inert", mobile);
      panel.setAttribute("aria-hidden", String(mobile));
    }
    applyLanguage() {
      I.applyDocument();
      this.syncQuickLayers();
      const country = A.activeCountry?.(),
        code = country?.code || C.activeCountryCode || "TR";
      for (const option of document.querySelectorAll("#countrySelector option"))
        option.textContent = I.countryName(option.value);
      const home = document.getElementById("brandHomeLink");
      if (home) home.setAttribute("href", I.url(code));
      if (country) this.setCountry(country, A.app?.state?.countryManifest);
      this.setLegendOpen(
        !document
          .getElementById("legendStack")
          ?.classList.contains("legendsHidden"),
      );
      this.setAnalysisOpen(
        !document
          .getElementById("analysisSummaryPanel")
          ?.classList.contains("analysisHidden"),
      );
      this.renderServices();
      this.setTime(A.app?.state?.selectedTime || new Date());
      this.setUpdated();
      if (this.lastMtgFrame) this.updateMtgTimeBadge(this.lastMtgFrame, false);
      if (A.app?.state) {
        this.renderImpact(A.app.state.fireImpacts || []);
        this.renderExportSummary(A.app.state);
        this.updateEnvironmentalKpis(
          A.app.state.wildfireSummaryData || [],
          A.app.state.windData || [],
        );
      }
      this.closeDetail(true);
      A.app?.map?.refreshLocalizedContent?.();
    }
    syncLayerDependents() {
      document
        .querySelectorAll(".layerDependent[data-depends-on]")
        .forEach((el) => {
          const input = document.getElementById(el.dataset.dependsOn);
          el.classList.toggle("dependentHidden", !input?.checked);
        });
    }
    toast(msg, type = "info") {
      const h = document.getElementById("toastHost"),
        d = document.createElement("div");
      d.className = `toast ${type}`;
      d.textContent = msg;
      h.appendChild(d);
      setTimeout(() => d.remove(), 5000);
    }
    updateService(s) {
      const current = this.services[s.id] || { name: s.id };
      this.services[s.id] = {
        ...current,
        ...s,
        last: s.state === "ok" ? new Date() : current.last,
      };
      this.renderServices();
    }
    renderServices() {
      const body = document.getElementById("serviceStatusBody");
      if (body) {
        const stateKey = {
          ok: "service.connected",
          error: "service.error",
          "no-frame": "service.noFrame",
          backfill: "service.backfill",
          loading: "service.loading",
          warn: "service.warn",
          idle: "service.idle",
        };
        body.innerHTML = Object.entries(this.services)
          .filter(([id]) => id !== "firms")
          .map(([, s]) => {
            const cls =
                s.state === "ok"
                  ? "status-ok"
                  : s.state === "error"
                    ? "status-bad"
                    : s.state === "no-frame" ||
                        s.state === "warn" ||
                        s.state === "backfill"
                      ? "status-warn"
                      : "status-idle",
              label = T(stateKey[s.state] || "service.idle"),
              name = s.nameKey ? T(s.nameKey) : s.name;
            return `<tr><td>${U.escapeHtml(name)}</td><td><span class="statusDot ${cls}"></span>${label}</td><td>${s.last ? U.formatLocal(s.last) : "—"}</td><td>${s.latency != null ? (s.latency === 0 ? T("service.cache") : s.latency + " ms") : "—"}</td><td>${s.count == null ? "—" : I.formatNumber(s.count)}</td><td>${U.escapeHtml(s.note || "")}</td></tr>`;
          })
          .join("");
      }
      this.renderThermalSources();
    }
    renderThermalSources() {
      const body = document.getElementById("thermalSourcesBody");
      if (!body || !A.ThermalSources) return;
      const rows = A.ThermalSources.thermalRows();
      if (this.isMobileMap()) {
        body.innerHTML = "";
        const cards = document.getElementById("thermalCards");
        if (cards) cards.innerHTML = rows.map((r) => this.thermalCardHtml(r)).join("");
        return;
      }
      const fmt = (v) => (v == null ? "—" : I.formatNumber(v)),
        fmtObs = (v) => (v ? U.formatLocal(new Date(v)) : "—");
      const cardsEl = document.getElementById("thermalCards");
      if (cardsEl) cardsEl.innerHTML = "";
      body.innerHTML = rows
        .map((r) => {
          const cls = this.thermalStatusClass(r.status);
          return `<tr><td><strong>${U.escapeHtml(T(r.labelKey))}</strong><span class="roleChips"><span class="chip">${U.escapeHtml(T(r.familyKey))}</span><span class="chip chipRisk">${U.escapeHtml(T(r.riskRoleKey))}</span></span></td><td><span class="statusDot ${cls}"></span>${U.escapeHtml(A.ThermalSources.statusLabel(r.status))}</td><td>${fmtObs(r.metrics.latestObservationAt)}</td><td>${fmt(r.metrics.deduplicatedCount)}</td><td>${fmt(r.metrics.thresholdCount)}</td><td>${fmt(r.metrics.confirmedEventCount)}</td><td>${U.escapeHtml(r.note || "")}</td></tr>`;
        })
        .join("");
    }
    thermalStatusClass(status) {
      return status === "ok"
        ? "status-ok"
        : status === "error"
          ? "status-bad"
          : ["warn", "partial", "stale", "unavailable"].includes(status)
            ? "status-warn"
            : "status-idle";
    }
    thermalCardHtml(r) {
      const cls = this.thermalStatusClass(r.status),
        fmt = (v) => (v == null ? "—" : I.formatNumber(v)),
        fmtObs = (v) => (v ? U.formatLocal(new Date(v)) : "—");
      const rows = [
        ["settings.role", T(r.familyKey)],
        ["settings.riskRole", T(r.riskRoleKey)],
        ["settings.latestObs", fmtObs(r.metrics.latestObservationAt)],
        ["settings.deduplicated", fmt(r.metrics.deduplicatedCount)],
        ["settings.threshold", fmt(r.metrics.thresholdCount)],
        ["settings.confirmedEvents", fmt(r.metrics.confirmedEventCount)],
        ["settings.note", r.note || "—"],
      ]
        .map(
          ([k, v]) =>
            `<div><small>${U.escapeHtml(T(k))}</small><strong>${U.escapeHtml(v)}</strong></div>`,
        )
        .join("");
      return `<details class="sourceCard"><summary><span class="sourceCardName">${U.escapeHtml(T(r.labelKey))}</span><span class="statusDot ${cls}"></span>${U.escapeHtml(A.ThermalSources.statusLabel(r.status))}</summary><div class="sourceCardBody">${rows}</div></details>`;
    }
    setTime(date) {
      document.getElementById("selectedTimeLocal").textContent =
        U.formatLocal(date);
      document.getElementById("selectedTimeUtc").textContent =
        U.formatUtc(date);
    }
    updateMtgTimeBadge(frame, showToast = true) {
      this.lastMtgFrame = frame;
      const badge = document.getElementById("mtgTimeBadge");
      if (!badge) return;
      const fmt = (iso) => (iso ? iso.slice(11, 16) : "—"),
        selected = fmt(frame.selected),
        displayed = fmt(frame.displayed);
      badge.textContent = frame.backfill
        ? T("mtg.badgeBackfill", { selected, displayed })
        : frame.displayed
          ? T("mtg.badge", { time: displayed })
          : T("mtg.badgeEmpty");
      badge.title = badge.textContent;
      if (
        showToast &&
        frame.state === "ok" &&
        frame.displayed &&
        this.lastMtgToast !== frame.displayed
      ) {
        this.lastMtgToast = frame.displayed;
        this.toast(T("mtg.toast", { time: displayed }));
      }
    }
    setNearestNote(t) {
      document.getElementById("nearestTimeNote").textContent =
        t || T("timeline.noteShort");
    }
    setUpdated() {
      document.getElementById("lastUpdated").textContent = T("status.updated", {
        time: U.formatLocal(new Date()),
      });
    }
    updateEnvironmentalKpis(wildfireData, windData) {
      const wf = (wildfireData || [])
          .map((x) => x.value)
          .filter(Number.isFinite),
        w = (windData || []).filter((x) => Number.isFinite(x.speed));
      const wfEl = document.getElementById("kpiWildfirePm10"),
        windEl = document.getElementById("kpiWind");
      if (wf.length) {
        const max = Math.max(...wf);
        wfEl.textContent = `${I.formatNumber(U.round(max, 1))} µg/m³`;
        wfEl.classList.toggle("zeroValue", max === 0);
        wfEl.parentElement.querySelector("small").textContent = T(
          max === 0 ? "kpi.smokeZero" : "kpi.smokeMax",
        );
      } else wfEl.textContent = "—";
      if (w.length) {
        const max = w.reduce((a, b) => (b.speed > a.speed ? b : a), w[0]);
        windEl.textContent = `${U.round(max.speed, 1)} km/h`;
        windEl.parentElement.querySelector("small").textContent =
          `${T(C.windLevels[max.level]?.labelKey) || max.level} · ${Math.round(max.direction)}° ${U.cardinal(max.direction)}`;
      } else windEl.textContent = "—";
    }
    openDetail(title, html) {
      this.closeQuickLayers();
      this.pendingDetail = { title, html };
      document.getElementById("detailTitle").textContent = title;
      document.getElementById("detailContent").innerHTML = html;
      if (this.isMobileMap()) {
        const mini = document.getElementById("mapMiniCard");
        document.getElementById("miniCardTitle").textContent = title;
        document.getElementById("miniCardSummary").textContent = T(
          html.includes("emptyState") ? "mini.loading" : "mini.ready",
        );
        mini.classList.remove("hidden");
        mini.setAttribute("aria-hidden", "false");
        return;
      }
      this.openFullDetail();
    }
    openFullDetail() {
      this.closeQuickLayers();
      const panel = document.getElementById("detailPanel");
      document.getElementById("detailTitle").textContent =
        this.pendingDetail.title;
      document.getElementById("detailContent").innerHTML =
        this.pendingDetail.html;
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
      if (this.isMobileMap())
        document.getElementById("detailBackdrop").classList.remove("hidden");
    }
    closeDetail(clearMini = false) {
      const panel = document.getElementById("detailPanel");
      panel.classList.remove("open");
      panel.setAttribute("aria-hidden", "true");
      document.getElementById("detailBackdrop")?.classList.add("hidden");
      if (clearMini) {
        const mini = document.getElementById("mapMiniCard");
        mini?.classList.add("hidden");
        mini?.setAttribute("aria-hidden", "true");
      }
    }
    val(v, d = 1, suffix = "") {
      return v != null && Number.isFinite(Number(v))
        ? U.round(Number(v), d) + suffix
        : "—";
    }
    assetLabel(properties, fallback = T("detail.undefinedLine")) {
      const p = properties || {};
      return p.name || p.ref || p.displayLabel || fallback;
    }
    evidenceSection(evidence) {
      const e = evidence || {},
        spatialOk =
          Number.isFinite(Number(e.nearestLineLatitude)) &&
          Number.isFinite(Number(e.nearestLineLongitude)),
        trig = { lat: Number(e.triggerLatitude), lon: Number(e.triggerLongitude) },
        center = {
          lat: Number(e.eventCenterLatitude),
          lon: Number(e.eventCenterLongitude),
        },
        centerDiff =
          Number.isFinite(trig.lat) && Number.isFinite(center.lat)
            ? U.haversineKm(center, trig)
            : null,
        coords = (lat, lon) =>
          `${lat != null && Number.isFinite(Number(lat)) ? Number(lat).toFixed(5) : "—"}, ${lon != null && Number.isFinite(Number(lon)) ? Number(lon).toFixed(5) : "—"}`,
        metrics = [];
      const metric = (label, value) =>
        metrics.push(
          `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`,
        );
      metric(
        T("detail.triggerSource"),
        e.triggerSource ? U.escapeHtml(e.triggerSource) : "—",
      );
      metric(
        T("detail.triggerSatellite"),
        e.triggerSatellite ? U.escapeHtml(e.triggerSatellite) : "—",
      );
      metric(
        T("detail.triggerInstrument"),
        [e.triggerInstrument, e.triggerProduct]
          .filter(Boolean)
          .map((x) => U.escapeHtml(x))
          .join(" · ") || "—",
      );
      metric(
        T("detail.triggerTime"),
        e.triggerDetectedAt
          ? U.formatLocal(new Date(e.triggerDetectedAt))
          : "—",
      );
      metric(T("detail.frp"), this.val(e.triggerFrpMw, 1, " MW"));
      metric(
        T("detail.confidence"),
        e.triggerConfidence != null
          ? U.escapeHtml(String(e.triggerConfidence))
          : "—",
      );
      metric(
        T("detail.dayNight"),
        e.triggerDayNight ? U.escapeHtml(String(e.triggerDayNight)) : "—",
      );
      metric(
        T("detail.triggerDistance"),
        this.val(e.triggerDistanceKm, 2, " km"),
      );
      metric(
        T("detail.triggerCoords"),
        coords(e.triggerLatitude, e.triggerLongitude),
      );
      metric(
        T("detail.nearestLinePoint"),
        spatialOk
          ? coords(e.nearestLineLatitude, e.nearestLineLongitude)
          : T("detail.evidenceSpatialFail"),
      );
      metric(
        T("detail.eventCenterCoords"),
        coords(e.eventCenterLatitude, e.eventCenterLongitude),
      );
      return `<div class="detailSection"><h3>${T("detail.riskEvidence")}</h3><div class="metricGrid">${metrics.join("")}</div>${
        centerDiff != null && centerDiff > 2
          ? `<div class="warningBox">${T("detail.clusterCenterNote")}</div>`
          : ""
      }<div class="sourceNote">${T("detail.selectionRule")}: ${U.escapeHtml(e.selectionRule || "—")} · ${T("detail.evidenceCount")}: ${I.formatNumber(Number(e.evidenceCount) || 0)}</div></div>`;
    }
    renderPointDetail(
      point,
      air,
      weather,
      nearbyFires,
      areaHistory,
      fire,
      fireEvent,
      gridFeature,
      nearest,
      riskEvidence,
    ) {
      const v = air?.values || {},
        w = weather?.values || {},
        gf = gridFeature?.properties || {};
      let title = fireEvent
        ? T("detail.fireEventTitle", { count: I.formatNumber(fireEvent.count) })
        : fire
          ? `FIRMS · ${fire.product}`
          : gridFeature
            ? T(
                gridFeature.kind === "substation"
                  ? "detail.substation"
                  : "detail.line",
              )
            : `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
      const hist = areaHistory && areaHistory.count > 0 ? areaHistory : null;
      const histLabel = T(
        hist && hist.window48 ? "detail.first48" : "detail.first",
      );
      const histMetrics = hist
        ? `<div class="metric"><small>${histLabel}</small><strong>${U.formatTrShortDateTime(new Date(hist.first))}</strong></div><div class="metric"><small>${T("detail.last")}</small><strong>${U.formatTrShortDateTime(new Date(hist.last))}</strong></div><div class="metric"><small>${T("detail.areaDetections")}</small><strong>${I.formatNumber(hist.count)}</strong></div>`
        : "";
      const nearestLine = nearest?.line,
        nearestSub = nearest?.substation,
        closest = Math.min(
          nearestLine?.distanceKm ?? Infinity,
          nearestSub?.distanceKm ?? Infinity,
        ),
        band = Number.isFinite(closest) ? U.impactBand(closest) : null;
      const gridBlock = gridFeature
        ? `<div class="detailSection"><h3>${T("detail.gridAsset")}</h3><div class="metricGrid"><div class="metric"><small>${T("common.type")}</small><strong>${T(gridFeature.kind === "substation" ? "summary.substations" : "detail.overhead")}</strong></div><div class="metric"><small>${T("detail.gridClass")}</small><strong>${U.escapeHtml(gf.displayClass || (gf.gridClass ? T("detail.kvClass", { value: gf.gridClass }) : "—"))}</strong></div><div class="metric"><small>${T("detail.actualVoltage")}</small><strong>${U.escapeHtml(U.formatVoltage(gf.actualVoltageKv) || T("common.unknown"))}</strong></div><div class="metric"><small>${T("detail.lineName")}</small><strong>${U.escapeHtml(gf.name || "—")}</strong></div><div class="metric"><small>${T("common.reference")}</small><strong>${U.escapeHtml(gf.ref || "—")}</strong></div><div class="metric"><small>${T("detail.identifier")}</small><strong>${U.escapeHtml(gf.displayLabel || "—")}</strong></div><div class="metric"><small>${T("common.operator")}</small><strong>${U.escapeHtml(gf.operator || "—")}</strong></div></div><div class="sourceNote">${T("common.source")}: ${U.escapeHtml(gf.sourceProvider || "OpenStreetMap")} · ODbL 1.0</div></div>`
        : "";
      const eventBlock = fireEvent
        ? `<div class="detailSection"><h3>${T("detail.cluster")}</h3><div class="metricGrid"><div class="metric"><small>${T("detail.eventDetections")}</small><strong>${I.formatNumber(fireEvent.count)}</strong></div><div class="metric"><small>${T("analysis.maxFrp")}</small><strong>${this.val(fireEvent.maxFrp, 1, " MW")}</strong></div>${histMetrics}</div><div class="sourceNote">${T("detail.clusterNote")}</div></div>`
        : "";
      const fireBlock =
        fire && !fireEvent
          ? `<div class="detailSection"><h3>${T("detail.thermal")}</h3><div class="metricGrid"><div class="metric"><small>${T("detail.detection")}</small><strong>${U.formatLocal(new Date(fire.detectedAt))}</strong></div><div class="metric"><small>FRP</small><strong>${this.val(fire.frp, 1, " MW")}</strong></div><div class="metric"><small>${T("detail.satelliteSensor")}</small><strong>${U.escapeHtml(fire.satellite || "—")} / ${U.escapeHtml(fire.sensor || "—")}</strong></div><div class="metric"><small>${T("detail.confidence")}</small><strong>${U.escapeHtml(fire.confidence || "—")}</strong></div>${histMetrics}</div><div class="sourceNote">${T("detail.hotspotNote")}</div></div>`
          : "";
      const proximity = `<div class="detailSection"><h3>${T("detail.proximity")}</h3><div class="metricGrid"><div class="metric"><small>${T("detail.nearestLine")}</small><strong>${nearestLine ? this.val(nearestLine.distanceKm, 2, " km") : T("detail.none50")}</strong></div><div class="metric"><small>${T("detail.lineClass")}</small><strong>${nearestLine ? U.escapeHtml(nearestLine.feature.props?.displayClass || T("common.unknown")) : "—"}</strong></div><div class="metric"><small>${T("detail.actualVoltage")}</small><strong>${nearestLine ? U.escapeHtml(U.formatVoltage(nearestLine.feature.props?.actualVoltageKv) || T("common.unknown")) : "—"}</strong></div><div class="metric"><small>${T("detail.nearestSubstation")}</small><strong>${nearestSub ? this.val(nearestSub.distanceKm, 2, " km") : T("detail.none50")}</strong></div><div class="metric"><small>${T("detail.distanceBand")}</small><strong class="riskText ${band?.level || "low"}">${band?.label || T("proximity.low")}</strong></div><div class="metric"><small>${T("detail.nearSegment")}</small><strong>${nearestLine ? this.val(U.haversineKm(nearestLine.feature.a, nearestLine.feature.b), 2, " km") : "—"}</strong></div></div><div class="sourceNote">${T("detail.proximityNote")}</div></div>`;
      const smokeBlock = `<div class="detailSection"><h3>${T("detail.smoke", { time: air?.validAt ? U.formatLocal(new Date(air.validAt)) : "—" })}</h3><div class="metricGrid"><div class="metric"><small>${T("detail.wildfirePm10")}</small><strong>${this.val(v.pm10_wildfires, 1, " µg/m³")}</strong></div><div class="metric"><small>${T("detail.resolution")}</small><strong>~11 km</strong></div><div class="metric"><small>${T("detail.dataType")}</small><strong>${T("detail.forecast")}</strong></div></div><div class="sourceNote">${T("detail.smokeNote")}</div></div>`;
      const weatherBlock = `<div class="detailSection"><h3>${T("detail.weather", { time: weather?.validAt ? U.formatLocal(new Date(weather.validAt)) : "—" })}</h3><div class="metricGrid"><div class="metric"><small>10 m</small><strong>${this.val(w.wind_speed_10m, 1, " km/h")} · ${w.wind_direction_10m != null ? Math.round(w.wind_direction_10m) + "° " + U.cardinal(w.wind_direction_10m) : "—"}</strong></div><div class="metric"><small>850 hPa</small><strong>${this.val(w.wind_speed_850hPa, 1, " km/h")} · ${w.wind_direction_850hPa != null ? Math.round(w.wind_direction_850hPa) + "°" : "—"}</strong></div><div class="metric"><small>700 hPa</small><strong>${this.val(w.wind_speed_700hPa, 1, " km/h")} · ${w.wind_direction_700hPa != null ? Math.round(w.wind_direction_700hPa) + "°" : "—"}</strong></div><div class="metric"><small>${T("detail.gustHumidity")}</small><strong>${this.val(w.wind_gusts_10m, 1, " km/h")} / ${this.val(w.relative_humidity_2m, 0, "%")}</strong></div></div><div class="sourceNote">${T("detail.windNote")}</div></div>`;
      const visibleDetections = nearbyFires.filter(
        (item) =>
          Number.isFinite(Number(item.fire?.frp)) &&
          Number(item.fire?.frp) >= 1,
      );
      const fireList = `<div class="detailSection"><h3>${T("detail.nearbyFirms")}</h3>${
        visibleDetections.length
          ? visibleDetections
              .slice(0, 12)
              .map(
                (n) =>
                  `<div class="fireRow"><span>${this.val(n.distance, 1, " km")} · ${this.val(n.fire.frp, 1, " MW")}</span><span>${U.formatLocal(new Date(n.fire.detectedAt))}</span></div>`,
              )
              .join("")
          : `<div class="emptyState">${T("detail.nearbyEmpty")}</div>`
      }</div>`;
      const evidenceBlock = riskEvidence
        ? this.evidenceSection(riskEvidence)
        : "";
      const badge = T(
        fire || fireEvent
          ? "detail.satelliteObservation"
          : gridFeature
            ? "detail.gridAssetBadge"
            : "detail.modelLocation",
      );
      this.openDetail(
        title,
        `<div><span class="badge ${fire || fireEvent ? "observation" : gridFeature ? "analysis" : "forecast"}">${badge}</span></div>${gridBlock}${eventBlock}${fireBlock}${proximity}${evidenceBlock}${smokeBlock}${weatherBlock}${fireList}`,
      );
      this.renderAnalysisSummary(
        point,
        air,
        weather,
        visibleDetections,
        gridFeature,
        nearest,
      );
      this.renderChart(air?.series || []);
    }
    renderAnalysisSummary(point, air, weather, nearby, gridFeature, nearest) {
      const v = air?.values || {},
        w = weather?.values || {},
        nline = nearest?.line,
        nsub = nearest?.substation;
      document.getElementById("analysisPointSummary").innerHTML =
        `<p><strong>${T("detail.coordinate")}:</strong> ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}</p>${gridFeature ? `<p><strong>${T("detail.asset")}:</strong> ${U.escapeHtml(this.assetLabel(gridFeature.properties, gridFeature.kind))}</p>` : ""}<p><strong>${T("detail.wildfirePm10")}:</strong> ${this.val(v.pm10_wildfires, 1, " µg/m³")}</p><p><strong>${T("analysis.wind")} 10 m:</strong> ${this.val(w.wind_speed_10m, 1, " km/h")} / ${w.wind_direction_10m != null ? Math.round(w.wind_direction_10m) + "°" : "—"}</p><p><strong>${T("detail.nearestLine")}:</strong> ${nline ? this.val(nline.distanceKm, 2, " km") : "—"}</p><p><strong>${T("detail.nearestSubstation")}:</strong> ${nsub ? this.val(nsub.distanceKm, 2, " km") : "—"}</p><p><strong>${T("detail.nearbyCount")}:</strong> ${I.formatNumber(nearby.length)}</p>`;
    }
    renderChart(series) {
      const canvas = document.getElementById("aqChart"),
        empty = document.getElementById("chartEmpty"),
        now = Date.now(),
        filtered = series.filter((x) => {
          const t = Date.parse(x.time);
          return t >= now - 24 * 3600e3 && t <= now + 48 * 3600e3;
        });
      if (!filtered.length || !window.Chart) {
        canvas.style.display = "none";
        empty.style.display = "block";
        return;
      }
      empty.style.display = "none";
      canvas.style.display = "block";
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: filtered.map((x) => U.formatLocal(new Date(x.time))),
          datasets: [
            {
              label: T("detail.chartLabel"),
              data: filtered.map((x) => x.pm10_wildfires),
              spanGaps: true,
              yAxisID: "y",
            },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { labels: { color: "#cbd8e4" } } },
          scales: {
            x: {
              ticks: { color: "#8aa0b2", maxTicksLimit: 11 },
              grid: { color: "#172637" },
            },
            y: {
              position: "left",
              title: { display: true, text: "µg/m³", color: "#8aa0b2" },
              ticks: { color: "#8aa0b2" },
              grid: { color: "#203041" },
            },
          },
        },
      });
    }
    renderGridSummary(s) {
      const c = s.counts || {},
        m = s.manifest || A.app?.state?.countryManifest || {},
        country =
          A.COUNTRIES[s.countryCode || A.CONFIG.activeCountryCode] ||
          A.COUNTRIES.TR,
        status = m.partial
          ? `<p class="warningBox"><strong>${T("summary.partial")}</strong> ${T("summary.missingParts", { count: I.formatNumber(m.failedRequests || 0) })}</p>`
          : "";
      document.getElementById("gridSummary").innerHTML =
        `<p><strong>${T("common.country")}:</strong> ${U.escapeHtml(I.countryName(country.code))}</p><p><strong>${T("summary.lines400")}:</strong> ${I.formatNumber(c["400"] || 0)}</p><p><strong>${T("summary.lines154")}:</strong> ${I.formatNumber(c["154"] || 0)}</p><p><strong>${T("summary.substations")}:</strong> ${I.formatNumber(c.substations || 0)}</p><p><strong>${T("summary.segments")}:</strong> ${I.formatNumber(s.segments || 0)}</p>${status}<p class="sourceNote">${T("summary.coreNote")}</p>`;
      document.getElementById("gridMetadata").innerHTML =
        `<p><strong>${T("summary.coverage")}:</strong> ${U.escapeHtml(I.countryCoverage(country.code))}</p><p><strong>${T("summary.rawFeature")}:</strong> ${I.formatNumber(m.rawFeatureCount || 0)}</p><p><strong>${T("summary.filter")}:</strong> line/minor_line/cable + substation · 50–550 kV</p><p><strong>${T("summary.core")}:</strong> ${I.formatNumber((c["400"] || 0) + (c["154"] || 0))} ${T("analysis.nearestLine").toLowerCase()} + ${I.formatNumber(c.substations || 0)} ${T("summary.substations")}</p><p><strong>${T("summary.license")}:</strong> ODbL 1.0 · © OpenStreetMap contributors</p>${status}`;
    }
    renderImpact(analyses) {
      const arr = analyses || [],
        critical = arr.filter((x) => x.riskScore >= 75),
        high = arr.filter((x) => x.riskScore >= 55 && x.riskScore < 75),
        medium = arr.filter((x) => x.riskScore >= 35 && x.riskScore < 55),
        lineKeys = new Set(),
        subKeys = new Set(),
        downwindLineKeys = new Set(),
        downwindSubKeys = new Set();
      for (const a of arr) {
        for (const x of a.affectedLines || []) lineKeys.add(x.key);
        for (const x of a.affectedSubstations || []) subKeys.add(x.key);
        if (a.riskScore >= 35) {
          for (const x of a.downwindAssets?.lines || [])
            downwindLineKeys.add(x.key);
          for (const x of a.downwindAssets?.substations || [])
            downwindSubKeys.add(x.key);
        }
      }
      document.getElementById("kpiCriticalEvents").textContent = I.formatNumber(
        critical.length,
      );
      document.getElementById("kpiRiskLines").textContent = I.formatNumber(
        lineKeys.size,
      );
      document.getElementById("kpiRiskSubstations").textContent =
        I.formatNumber(subKeys.size);
      document.getElementById("impactSummary").innerHTML =
        `<p><strong>${T("risk.critical")} (75+):</strong> ${I.formatNumber(critical.length)}</p><p><strong>${T("risk.high")} (55–74):</strong> ${I.formatNumber(high.length)}</p><p><strong>${T("risk.medium")} (35–54):</strong> ${I.formatNumber(medium.length)}</p><p><strong>${T("summary.totalEvents")}:</strong> ${I.formatNumber(arr.length)}</p><p><strong>${T("summary.uniqueLines")}:</strong> ${I.formatNumber(lineKeys.size)}</p><p><strong>${T("summary.uniqueSubstations")}:</strong> ${I.formatNumber(subKeys.size)}</p><p><strong>${T("summary.downwindLines")}:</strong> ${I.formatNumber(downwindLineKeys.size)}</p><p><strong>${T("summary.downwindSubstations")}:</strong> ${I.formatNumber(downwindSubKeys.size)}</p><p class="sourceNote">${T("summary.scoreNote")}</p>`;
      let rows = this.riskTableRows(arr);
      document
        .querySelectorAll("#impactTable th[data-sort]")
        .forEach((th) =>
          th.classList.toggle(
            "sorted-asc",
            th.dataset.sort === this.sortKey && this.sortDir === 1,
          ),
        );
      document
        .querySelectorAll("#impactTable th[data-sort]")
        .forEach((th) =>
          th.classList.toggle(
            "sorted-desc",
            th.dataset.sort === this.sortKey && this.sortDir === -1,
          ),
        );
      const body = document.getElementById("impactTableBody");
      body.innerHTML = rows.length
        ? rows
            .map((a, i) => {
              const obj = this.getNearestDisplayedAsset(a),
                props = obj?.feature.props,
                dw = a.downwindAssets || { lines: [], substations: [] },
                wind = a.wind
                  ? `${T(a.downwindAlignment ? "summary.aligned" : "summary.crosswind")} · ${I.formatNumber(U.round(a.wind.speed, 0))} km/h<br><small>${T("summary.corridor", { lines: I.formatNumber(dw.lines.length), substations: I.formatNumber(dw.substations.length) })}</small>`
                  : "—",
                riskLabel = T(`risk.${a.riskBand.level}`),
                evidence = a.evidence;
              return `<tr data-risk-index="${i}"><td><span class="riskBadge ${a.riskBand.level}">${a.riskScore} · ${U.escapeHtml(riskLabel)}</span></td><td>${T("summary.detections", { count: I.formatNumber(a.event.count) })}</td><td>${this.val(a.event.maxFrp, 1, " MW")}</td><td>${obj ? T("detail.line") : ""}<br><small>${obj ? U.escapeHtml(this.assetLabel(props)) : T("summary.noLine")}</small></td><td>${this.val(obj?.distanceKm, 2, " km")}</td><td>${obj ? `${U.escapeHtml(props?.displayClass || "—")}<br><small>${U.escapeHtml(U.formatVoltage(props?.actualVoltageKv) || T("common.unknown"))}</small>` : "—"}</td><td>${wind}</td><td>${U.formatLocal(new Date(a.event.latestDetectedAt))}</td><td>${evidence ? `${U.escapeHtml(evidence.triggerSource || "—")}<br><small>${U.escapeHtml(evidence.triggerSatellite || "—")}${evidence.triggerFrpMw != null ? ` · ${this.val(evidence.triggerFrpMw, 1, " MW")}` : ""}</small>` : "—"}</td><td>${evidence ? `<button type="button" class="evidenceBtn" data-evidence-btn="${i}" title="${T("analysis.showEvidence")}" aria-label="${T("analysis.showEvidence")}">${T("analysis.showEvidenceShort")}</button>` : "—"}</td></tr>`;
            })
            .join("")
        : `<tr><td colspan="10">${T("summary.noEvents")}</td></tr>`;
      body
        .querySelectorAll("tr[data-risk-index]")
        .forEach((el) =>
          el.addEventListener("click", () =>
            A.Events.emit("focusRisk", rows[Number(el.dataset.riskIndex)]),
          ),
        );
      body
        .querySelectorAll("button[data-evidence-btn]")
        .forEach((btn) =>
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            A.Events.emit("focusRisk", rows[Number(btn.dataset.evidenceBtn)]);
          }),
        );
      this.renderRiskSummary();
    }
    getNearestDisplayedAsset(row) {
      return row.nearestLine || null;
    }
    riskTableRows(analyses) {
      let rows = (analyses || [])
        .filter(
          (a) =>
            a.event?.countryCode === C.activeCountryCode &&
            a.minDistanceKm != null &&
            a.minDistanceKm <= 25,
        )
        .slice(0, 200);
      if (this.sortKey) {
        const d = this.sortDir;
        rows.sort((a, b) => {
          let va, vb;
          switch (this.sortKey) {
            case "riskScore":
              va = a.riskScore;
              vb = b.riskScore;
              break;
            case "count":
              va = a.event.count;
              vb = b.event.count;
              break;
            case "maxFrp":
              va = a.event.maxFrp;
              vb = b.event.maxFrp;
              break;
            case "asset": {
              const la = a.nearestLine || a.nearest?.line,
                lb = b.nearestLine || b.nearest?.line;
              va = this.assetLabel(la?.feature?.props).toLowerCase();
              vb = this.assetLabel(lb?.feature?.props).toLowerCase();
              break;
            }
            case "distance": {
              const la = a.nearestLine || a.nearest?.line;
              va = la ? la.distanceKm : Infinity;
              const lb = b.nearestLine || b.nearest?.line;
              vb = lb ? lb.distanceKm : Infinity;
              break;
            }
            case "voltage": {
              const la = a.nearestLine || a.nearest?.line;
              va = Number(la?.feature?.props?.actualVoltageKv) || 0;
              const lb = b.nearestLine || b.nearest?.line;
              vb = Number(lb?.feature?.props?.actualVoltageKv) || 0;
              break;
            }
            case "wind":
              va = a.wind ? (a.downwindAlignment ? 2 : 1) : 0;
              vb = b.wind ? (b.downwindAlignment ? 2 : 1) : 0;
              break;
            case "latest":
              va = new Date(a.event.latestDetectedAt).getTime();
              vb = new Date(b.event.latestDetectedAt).getTime();
              break;
            default:
              va = 0;
              vb = 0;
          }
          if (va < vb) return -d;
          if (va > vb) return d;
          return 0;
        });
      }
      return rows;
    }
    setLegendOpen(open) {
      const stack = document.getElementById("legendStack");
      const btn = document.getElementById("legendToggleBtn");
      if (!stack) return;
      stack.classList.toggle("legendsHidden", !open);
      stack.setAttribute("aria-hidden", String(!open));
      if (btn) {
        btn.textContent = T(open ? "toggle.legendsHide" : "toggle.legendsShow");
        btn.setAttribute("aria-expanded", String(open));
      }
    }
    setAnalysisOpen(open) {
      const panel = document.getElementById("analysisSummaryPanel");
      const btn = document.getElementById("analysisToggle");
      if (!panel) return;
      panel.classList.toggle("analysisHidden", !open);
      panel.setAttribute("aria-hidden", String(!open));
      if (btn) {
        btn.textContent = T(
          open ? "toggle.analysisHide" : "toggle.analysisShow",
        );
        btn.setAttribute("aria-expanded", String(open));
      }
      if (open) this.renderRiskSummary();
    }
    holdLayerPanel() {
      /* Layer panel is not part of the mobile map interaction model. */
    }
    renderRiskSummary() {
      const panel = document.getElementById("analysisSummaryPanel"),
        body = document.getElementById("analysisSummaryBody");
      if (!panel || !body || panel.classList.contains("analysisHidden")) return;
      const rows = this.riskTableRows(A.app?.state?.fireImpacts || []);
      body.innerHTML = rows.length
        ? rows
            .slice(0, 5)
            .map((a, i) => this.riskSummaryCard(a, i))
            .join("")
        : `<div class="emptyState">${T("ui.noActiveRisk")}</div>`;
      body
        .querySelectorAll(".riskCard")
        .forEach((el) =>
          el.addEventListener("click", () =>
            A.Events.emit("focusRisk", rows[Number(el.dataset.riskIndex)]),
          ),
        );
    }
    riskSummaryCard(a, i) {
      const obj = this.getNearestDisplayedAsset(a),
        props = obj?.feature?.props,
        vol = U.formatVoltage(props?.actualVoltageKv);
      const assetLabel = obj
        ? `${U.escapeHtml(props?.displayClass || "—")} · ${vol ? U.escapeHtml(vol) + " · " : ""}${U.escapeHtml(this.assetLabel(props))}`
        : T("summary.noLine");
      const shortId =
        String(a.event?.id || "")
          .split("-")
          .at(-1) || "—";
      const level = a.riskBand?.level || "watch",
        wind = a.wind
          ? ` · ${a.downwindAlignment ? T("summary.windImpact", { distance: a.corridorDistanceKm || "—" }) : T("summary.crosswind")}`
          : "";
      return `<div class="riskCard" data-risk-event="${U.escapeHtml(a.event?.id || "")}" data-risk-index="${i}"><div class="riskCardTop"><span class="riskRank">#${i + 1}</span><span class="riskBadge ${level}">${U.escapeHtml(T(`risk.${level}`))}</span></div><div class="riskCardFire">${T("summary.fire", { id: U.escapeHtml(shortId), count: I.formatNumber(a.event?.count || 0) })}</div><div class="riskCardNearest"><span class="nLabel">${T("summary.nearestLine")}</span><span class="nName">${assetLabel}</span><span class="nDist">${this.val(obj?.distanceKm, 1, " km")}</span></div><div class="riskCardMeta">FRP: ${this.val(a.event?.maxFrp, 0, " MW")}${wind} · ${T("summary.score", { score: a.riskScore })}</div></div>`;
    }
    renderExportSummary(state) {
      const code = state.countryCode || "TR";
      document.getElementById("exportSummary").innerHTML =
        `<p><strong>${T("export.country")}:</strong> ${U.escapeHtml(I.countryName(code))} (${code})</p><p><strong>${T("export.rawFires")}:</strong> ${I.formatNumber(state.fireData?.length || 0)}</p><p><strong>${T("export.events")}:</strong> ${I.formatNumber(state.fireEvents?.length || 0)}</p><p><strong>${T("export.impacts")}:</strong> ${I.formatNumber(state.fireImpacts?.length || 0)}</p><p><strong>${T("export.smoke")}:</strong> ${state.smokeVariable || T("common.off")} · ${I.formatNumber(state.smokeData?.filter((x) => x.value != null).length || 0)}</p><p><strong>${T("export.wind")}:</strong> ${state.windLevel || "10m"} · ${I.formatNumber(state.windData?.length || 0)}</p><p><strong>${T("export.time")}:</strong> ${U.formatUtc(state.selectedTime)}</p>`;
    }
  }
  A.UIManager = UIManager;
})(window.AtmoApp);
