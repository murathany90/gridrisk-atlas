(function (A) {
  const U = A.Utils,
    C = A.CONFIG,
    I = A.I18n;
  class CountryManager {
    constructor(app) {
      this.app = app;
      this.state = app.state;
    }
    static normalize(code) {
      const value = String(code || "")
        .trim()
        .toUpperCase();
      return A.COUNTRIES[value] ? value : "TR";
    }
    static resolveInitial(search = location.search, storage = localStorage) {
      const urlCode = new URLSearchParams(search || "").get("country");
      if (urlCode)
        return A.COUNTRIES[String(urlCode).toUpperCase()]
          ? String(urlCode).toUpperCase()
          : "TR";
      const stored = storage?.getItem?.("selectedCountry");
      return A.COUNTRIES[String(stored || "").toUpperCase()]
        ? String(stored).toUpperCase()
        : "TR";
    }
    isCurrent(seq, code) {
      return seq === this.state.countrySeq && code === this.state.countryCode;
    }
    async init() {
      return this.switchCountry(CountryManager.resolveInitial(), {
        initial: true,
      });
    }
    async switchCountry(requested, { initial = false } = {}) {
      const code = CountryManager.normalize(requested),
        country = A.COUNTRIES[code];
      if (
        !initial &&
        code === this.state.countryCode &&
        this.state.countryManifest
      )
        return true;
      const seq = ++this.state.countrySeq;
      this.state.countryCode = code;
      this.state.countryAbortController?.abort("country-switch");
      this.app.abortCountryRequests();
      const controller = new AbortController();
      this.state.countryAbortController = controller;
      this.app.resetCountryState(code);
      this.app.ui.setCountryLoading?.(country);
      const selector = document.getElementById("countrySelector");
      if (selector) selector.value = code;
      localStorage.setItem("selectedCountry", code);
      const url = new URL(location.href);
      url.searchParams.set("country", code);
      url.searchParams.set("lang", I.locale);
      history.replaceState({ country: code, lang: I.locale }, "", url);
      try {
        const [boundaryResult, manifestResult] = await Promise.all([
          U.fetchJson(
            `${country.boundaryUrl}?v=${encodeURIComponent(C.appVersion)}`,
            {
              signal: controller.signal,
              cacheKey: `boundary:${code}`,
              ttl: C.cacheTtl.grid,
            },
          ),
          U.fetchJson(
            `${country.manifestUrl}?v=${encodeURIComponent(C.appVersion)}`,
            {
              signal: controller.signal,
              cacheKey: `manifest:${code}`,
              ttl: C.cacheTtl.grid,
            },
          ),
        ]);
        if (!this.isCurrent(seq, code)) return false;
        const boundary = boundaryResult.data,
          manifest = manifestResult.data;
        A.applyCountryConfig(code, boundary);
        this.state.countryBoundary = boundary;
        this.state.countryManifest = manifest;
        this.app.map.setCountryBoundary(boundary, country, true);
        this.app.grid.setCountry(code, manifest);
        this.app.ui.setCountry?.(country, manifest);
        await this.app.grid.loadCore(controller.signal);
        if (!this.isCurrent(seq, code)) return false;
        await this.app.onCountryReady({
          seq,
          code,
          country,
          manifest,
          initial,
        });
        return this.isCurrent(seq, code);
      } catch (error) {
        if (
          error.kind === "ABORTED" ||
          controller.signal.aborted ||
          !this.isCurrent(seq, code)
        )
          return false;
        this.app.ui.toast(
          I.t("error.countryLoad", {
            country: I.countryName(code),
            error: error.kind || error.message,
          }),
          "error",
        );
        A.Events.emit("service", {
          id: "grid",
          state: "error",
          note: `${I.countryName(code)} · ${error.message}`,
        });
        return false;
      }
    }
  }
  A.CountryManager = CountryManager;
})(window.AtmoApp);
