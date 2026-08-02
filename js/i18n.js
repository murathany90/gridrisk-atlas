(function (A) {
  const supported = ["tr", "en"],
    listeners = new Set(),
    fallback = "tr";
  const storageGet = () => {
    try {
      return localStorage.getItem("uiLanguage");
    } catch {
      return null;
    }
  };
  const normalize = (value) =>
    supported.includes(
      String(value || "")
        .trim()
        .toLowerCase(),
    )
      ? String(value).trim().toLowerCase()
      : fallback;
  const initial = () => {
    try {
      const value = new URLSearchParams(location.search || "").get("lang");
      return value ? normalize(value) : normalize(storageGet());
    } catch {
      return normalize(storageGet());
    }
  };
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[ch],
    );
  const api = {
    locale: initial(),
    normalize,
    intlLocale() {
      return this.locale === "en" ? "en-GB" : "tr-TR";
    },
    t(key, params = {}) {
      const primary = A.LOCALES?.[this.locale] || {},
        secondary = A.LOCALES?.[this.locale === "tr" ? "en" : "tr"] || {};
      let value = primary[key] ?? secondary[key];
      if (value == null) {
        const loc = globalThis.location;
        if (
          ["localhost", "127.0.0.1"].includes(loc?.hostname) ||
          loc?.protocol === "file:"
        )
          console.warn(`[i18n] Missing translation: ${key}`);
        return "";
      }
      return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) =>
        params[name] == null ? "" : String(params[name]),
      );
    },
    tHtml(key, params = {}) {
      const safe = {};
      for (const [name, value] of Object.entries(params))
        safe[name] = escapeHtml(value);
      return this.t(key, safe);
    },
    formatNumber(value, options) {
      const n = Number(value);
      return Number.isFinite(n)
        ? new Intl.NumberFormat(this.intlLocale(), options).format(n)
        : "—";
    },
    formatDate(date, options = {}) {
      const value = date instanceof Date ? date : new Date(date);
      if (!Number.isFinite(value.getTime())) return "—";
      const timezone = A.activeCountry?.()?.timezone || "UTC";
      return new Intl.DateTimeFormat(this.intlLocale(), {
        timeZone: timezone,
        ...options,
      }).format(value);
    },
    countryName(code) {
      const c = A.COUNTRIES?.[code] || A.COUNTRIES?.TR;
      return c?.name?.[this.locale] || c?.name?.tr || c?.nameTr || code || "";
    },
    countryCoverage(code) {
      const c = A.COUNTRIES?.[code] || A.COUNTRIES?.TR;
      return (
        c?.coverageNote?.[this.locale] ||
        c?.coverageNote?.tr ||
        c?.coverageNote ||
        ""
      );
    },
    url(country) {
      const url = new URL(location.href);
      url.searchParams.set(
        "country",
        country || A.CONFIG?.activeCountryCode || "TR",
      );
      url.searchParams.set("lang", this.locale);
      return `${url.pathname}${url.search}${url.hash}`;
    },
    applyDocument(root = document) {
      const scope = root || document;
      scope.querySelectorAll?.("[data-i18n]").forEach((el) => {
        const value = this.t(el.dataset.i18n);
        if (value) el.textContent = value;
      });
      for (const [attr, target] of [
        ["data-i18n-title", "title"],
        ["data-i18n-aria-label", "aria-label"],
        ["data-i18n-placeholder", "placeholder"],
      ])
        scope.querySelectorAll?.(`[${attr}]`).forEach((el) => {
          const value = this.t(el.getAttribute(attr));
          if (value) el.setAttribute(target, value);
        });
      document.documentElement.lang = this.locale;
      document.title = this.t("app.title");
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.content = this.t("app.description");
      const selector = document.getElementById("languageSelector");
      if (selector) selector.value = this.locale;
    },
    setLanguage(value) {
      const next = normalize(value);
      this.locale = next;
      try {
        localStorage.setItem("uiLanguage", next);
      } catch {}
      const country =
        document.getElementById("countrySelector")?.value ||
        A.CONFIG?.activeCountryCode ||
        "TR";
      try {
        history.replaceState({ country, lang: next }, "", this.url(country));
      } catch {}
      this.applyDocument();
      for (const handler of [...listeners]) handler(next);
      return next;
    },
    onChange(handler) {
      if (typeof handler === "function") listeners.add(handler);
      return () => listeners.delete(handler);
    },
    keySetsMatch() {
      const tr = Object.keys(A.LOCALES?.tr || {}).sort(),
        en = Object.keys(A.LOCALES?.en || {}).sort();
      return (
        tr.length === en.length && tr.every((key, index) => key === en[index])
      );
    },
  };
  A.I18n = api;
  document.documentElement.lang = api.locale;
  if (typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (document.documentElement.lang !== api.locale)
        document.documentElement.lang = api.locale;
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  }
})((window.AtmoApp = window.AtmoApp || {}));
