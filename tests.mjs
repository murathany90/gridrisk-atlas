import { readFileSync, readdirSync, statSync } from "fs";
import { strict as assert } from "assert";
import vm from "vm";

const read = (path) => readFileSync(path, "utf8");
const html = read("index.html");
const css = read("css/styles.css");
const readme = read("README.md");
const pagesWorkflow = read(".github/workflows/pages.yml");
const manifest = JSON.parse(read("manifest.webmanifest"));
const pkg = JSON.parse(read("package.json"));
const source = Object.fromEntries(
  [
    "app",
    "ui",
    "map",
    "grid",
    "api",
    "export",
    "countries",
    "utils",
    "config",
    "i18n",
  ].map((name) => [name, read(`js/${name}.js`)]),
);

const storage = new Map();
const documentStub = {
  documentElement: { lang: "tr" },
  title: "",
  createElement(tag) {
    const el = {
      tag,
      style: {},
      dataset: {},
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      },
      addEventListener() {},
      remove() {},
      appendChild() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      setAttribute() {},
    };
    if (tag === "a") {
      el.click = () => {};
      el.href = "";
    }
    return el;
  },
  body: { appendChild() {}, removeChild() {} },
  getElementById() {
    return null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};
global.window = global;
global.document = documentStub;
global.location = {
  protocol: "https:",
  hostname: "localhost",
  pathname: "/",
  search: "?country=TR&lang=tr",
  hash: "",
  href: "https://localhost/?country=TR&lang=tr",
};
global.history = {
  replaceState(_state, _title, url) {
    global.location.href = new URL(url, global.location.href).href;
  },
};
global.localStorage = {
  getItem(key) {
    return storage.get(key) ?? null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};
global.L = {
  Layer: class {},
  CircleMarker: class {},
  point(x, y) {
    return { x, y };
  },
  DomUtil: {
    create() {
      return {};
    },
    setPosition() {},
  },
  DomEvent: { stopPropagation() {} },
};

for (const path of [
  "js/locales/tr.js",
  "js/locales/en.js",
  "js/i18n.js",
  "js/config.js",
  "js/utils.js",
  "js/countries.js",
  "js/grid.js",
  "js/thermal-sources.js",
  "js/map.js",
  "js/export.js",
])
  vm.runInThisContext(read(path), { filename: path });

const A = global.AtmoApp;
const I = A.I18n;
const U = A.Utils;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("brand, subtitle and v3.7.0 are synchronized", () => {
  assert.equal(A.CONFIG.appName, "GridRisk Atlas");
  assert.equal(A.CONFIG.appVersion, "3.7.0");
  assert.equal(pkg.name, "gridrisk-atlas");
  assert.equal(pkg.version, "3.7.0");
  assert.match(html, /<h1[^>]*data-i18n="app\.name"[^>]*>\s*GridRisk Atlas/);
  assert.ok(html.includes("Satellite Wildfire &amp; Grid Risk Intelligence"));
  assert.match(html, /<html lang="tr" translate="no">/);
  assert.match(html, /<meta name="google" content="notranslate"/);
  assert.equal(
    /GridMoni|Wildfire Grid Risk Monitor/.test(html + source.app + source.ui),
    false,
  );
});

test("PWA and social metadata use GridRisk Atlas and relative runtime paths", () => {
  assert.equal(manifest.name, "GridRisk Atlas");
  assert.equal(manifest.short_name, "GridRisk");
  assert.equal(manifest.start_url, "./?country=TR&lang=tr");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.every((icon) => !icon.src.startsWith("/")));
  assert.ok(html.includes("https://gridriskatlas.com/"));
  assert.equal(html.includes("/tr_wildfire/"), false);
});

test("repository, README and Pages workflow use the renamed project", () => {
  const combined = `${readme}\n${pagesWorkflow}\n${JSON.stringify(pkg)}`;
  assert.match(readme, /^# GridRisk Atlas$/m);
  assert.ok(readme.includes("Satellite Wildfire & Grid Risk Intelligence"));
  assert.ok(readme.includes("https://gridriskatlas.com/"));
  assert.ok(
    readme.includes("https://github.com/murathany90/gridrisk-atlas.git"),
  );
  assert.ok(html.includes("https://github.com/murathany90/gridrisk-atlas"));
  assert.match(pagesWorkflow, /gridrisk-atlas-header\.png/);
  assert.equal(
    /tr_wildfire|GridMoni|Wildfire Grid Risk Monitor/.test(combined),
    false,
  );
});

test("TR and EN dictionaries have identical, complete key sets", () => {
  assert.equal(I.keySetsMatch(), true);
  assert.deepEqual(
    Object.keys(A.LOCALES.tr).sort(),
    Object.keys(A.LOCALES.en).sort(),
  );
  assert.ok(Object.keys(A.LOCALES.tr).length >= 400);
});

test("safe interpolation, fallback and unsupported locale behavior", () => {
  I.locale = "en";
  assert.equal(I.t("status.dataFor", { country: "France" }), "DATA: France");
  assert.equal(I.normalize("de"), "tr");
  assert.equal(I.t("missing.key"), "");
  I.locale = "tr";
});

test("URL language has priority and localStorage is the second choice", () => {
  const evaluate = (search, stored) => {
    const ctx = {
      URLSearchParams,
      URL,
      Intl,
      console,
      location: {
        search,
        href: `https://example.test/${search}`,
        hostname: "example.test",
        protocol: "https:",
        pathname: "/",
        hash: "",
      },
      localStorage: { getItem: () => stored, setItem() {} },
      history: { replaceState() {} },
      document: {
        documentElement: {},
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById: () => null,
      },
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const file of ["js/locales/tr.js", "js/locales/en.js", "js/i18n.js"])
      vm.runInContext(read(file), ctx);
    return ctx.AtmoApp.I18n.locale;
  };
  assert.equal(evaluate("?lang=en", "tr"), "en");
  assert.equal(evaluate("", "en"), "en");
  assert.equal(evaluate("?lang=xx", "en"), "tr");
});

test("language switch updates html lang and preserves country in URL", () => {
  A.CONFIG.activeCountryCode = "FR";
  I.setLanguage("en");
  assert.equal(document.documentElement.lang, "en");
  assert.match(location.href, /country=FR/);
  assert.match(location.href, /lang=en/);
  I.setLanguage("tr");
});

test("locale and country timezone remain independent", () => {
  const instant = new Date("2026-07-15T12:00:00Z");
  A.CONFIG.activeCountryCode = "TR";
  I.locale = "en";
  const trCountryTime = I.formatDate(instant, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  A.CONFIG.activeCountryCode = "PT";
  const ptCountryTime = I.formatDate(instant, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  assert.notEqual(trCountryTime, ptCountryTime);
  assert.equal(I.formatNumber(1234.5).includes(","), true);
  I.locale = "tr";
  assert.equal(I.formatNumber(1234.5).includes("."), true);
});

test("five countries expose localized names, coverage and correct timezones", () => {
  const zones = {
    TR: "Europe/Istanbul",
    ES: "Europe/Madrid",
    FR: "Europe/Paris",
    PT: "Europe/Lisbon",
    IT: "Europe/Rome",
  };
  assert.deepEqual(Object.keys(A.COUNTRIES), Object.keys(zones));
  for (const [code, zone] of Object.entries(zones)) {
    assert.equal(A.COUNTRIES[code].timezone, zone);
    assert.ok(A.COUNTRIES[code].name.tr && A.COUNTRIES[code].name.en);
    assert.ok(
      A.COUNTRIES[code].coverageNote.tr && A.COUNTRIES[code].coverageNote.en,
    );
  }
});

test("risk and proximity internal levels stay stable across languages", () => {
  for (const locale of ["tr", "en"]) {
    I.locale = locale;
    assert.equal(U.riskScoreBand(80).level, "critical");
    assert.equal(U.riskScoreBand(60).level, "high");
    assert.equal(U.riskScoreBand(40).level, "medium");
    assert.equal(U.riskScoreBand(10).level, "watch");
    assert.equal(U.impactBand(0.4).level, "critical");
  }
});

test("fire normalization, deduplication and clustering remain deterministic", () => {
  const rows = [
    {
      countryCode: "TR",
      product: "VIIRS",
      satellite: "N20",
      detectedAt: "2026-08-01T10:00:00Z",
      lat: 39,
      lon: 35,
      frp: 50,
    },
    {
      countryCode: "TR",
      product: "VIIRS",
      satellite: "N20",
      detectedAt: "2026-08-01T10:00:00Z",
      lat: 39,
      lon: 35,
      frp: 60,
    },
  ];
  const deduped = U.deduplicateDetections(rows);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].frp, 60);
  const clustered = U.clusterFires([
    rows[0],
    { ...rows[0], detectedAt: "2026-08-01T11:00:00Z", lat: 39.01 },
  ]);
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].count, 2);
});

test("normalized thermal detection fixtures (FIRMS, S3A, S3B, missing fields, backward compat)", () => {
  const prevCountry = A.CONFIG.activeCountryCode;
  A.CONFIG.activeCountryCode = "TR";
  try {
    const S3A_RAW = {
    id: "f_01A2B3C4D5E6F7",
    sourceId: "sentinel3a-slstr",
    source: "Sentinel-3A SLSTR",
    sensorFamily: "slstr",
    platform: "Sentinel-3A",
    satellite: "Sentinel-3A",
    sensor: "SLSTR",
    product: "copernicus:frp",
    processingMode: "realtime",
    detectedAt: "2026-08-02T01:10:00Z",
    receivedAt: "2026-08-02T01:22:00Z",
    lat: "38.72",
    lon: "35.05",
    frpMw: "35.5",
    frpUncertaintyMw: "7.1",
    brightnessTemperatureK: 352.1,
    confidenceRaw: "high",
    cloudFraction: 0.02,
    qualityFlags: "valid",
    dayNight: "N",
    countryCode: "TR",
  };
  const s3a = U.normalizeFireDetection(S3A_RAW);
  assert.equal(s3a.detectionId, "f_01A2B3C4D5E6F7");
  assert.equal(s3a.nativeId, "f_01A2B3C4D5E6F7");
  assert.equal(s3a.sourceId, "sentinel3a-slstr");
  assert.equal(s3a.sourceName, "Sentinel-3A SLSTR");
  assert.equal(s3a.sensorFamily, "slstr");
  assert.equal(s3a.frpMw, 35.5);
  assert.equal(s3a.frpMw, s3a.frp);
  assert.equal(s3a.sourceName, s3a.source);
  assert.equal(s3a.frpUncertaintyMw, 7.1);
  assert.equal(s3a.confidenceRaw, "high");
  assert.equal(s3a.confidence, "high");
  assert.equal(s3a.confidenceNormalized, 1);
  assert.equal(s3a.detectedAt, "2026-08-02T01:10:00Z");
  assert.equal(s3a.receivedAt, "2026-08-02T01:22:00Z");
  assert.equal(s3a.cloudFraction, 0.02);
  assert.equal(s3a.qualityFlags, "valid");
  assert.equal(s3a.dayNight, "N");
  const s3b = U.normalizeFireDetection({
    ...S3A_RAW,
    sourceId: "sentinel3b-slstr",
    satellite: "Sentinel-3B",
    platform: "Sentinel-3B",
    detectedAt: "2026-08-02T02:40:00Z",
  });
  assert.equal(s3b.sourceId, "sentinel3b-slstr");
  assert.equal(s3b.satellite, "Sentinel-3B");

  const firms = U.normalizeFireDetection(
    {
      latitude: "38.4",
      longitude: "36.1",
      acq_date: "2026-08-01",
      acq_time: "935",
      instrument: "VIIRS",
      satellite: "NOAA-21",
      confidence: "85",
      frp: "42.3",
      daynight: "D",
      bright_ti4: 355,
      bright_ti5: 310,
      scan: 1.1,
      track: 0.6,
      version: "1.0",
    },
    { source: "NASA FIRMS", sourceId: "nasa-firms", product: "VIIRS" },
  );
  assert.equal(firms.frpMw, 42.3);
  assert.equal(firms.sourceName, "NASA FIRMS");
  assert.equal(firms.sourceId, "nasa-firms");
  assert.equal(firms.sensor, "VIIRS");
  assert.equal(firms.satellite, "NOAA-21");
  assert.equal(firms.confidenceRaw, "85");
  assert.equal(firms.confidenceNormalized, 0.85);
  assert.equal(firms.pixelWidthKm, 1.1);
  assert.equal(firms.pixelHeightKm, 0.6);
  assert.equal(firms.effectivePixelAreaKm2, 0.66);
  assert.equal(firms.detectedAt, "2026-08-01T09:35:00Z");
  assert.equal(firms.brightTi4K, 355);
  assert.equal(firms.countryCode, "TR");
  const viaAcqTimePadded = U.normalizeFireDetection(
    { latitude: "3.3", longitude: "4.4", acq_date: "2026-08-01", acq_time: "25" },
    { sourceId: "nasa-firms" },
  );
  assert.equal(viaAcqTimePadded.detectedAt, "2026-08-01T00:25:00Z");

  const missing = U.normalizeFireDetection(
    { longitude: "nan", lat: "35xN", detectedAt: "not-a-date", frpMw: "NaN" },
    {},
  );
  assert.equal(missing.lat, null);
  assert.equal(missing.lon, null);
  assert.equal(missing.detectedAt, null);
  assert.equal(missing.frpMw, null);
  assert.equal(missing.frpUncertaintyMw, null);
  assert.equal(missing.confidenceRaw, null);
  assert.equal(missing.qualityFlags, null);
  const gR = JSON.stringify({ ...missing, rawProperties: undefined });
  assert.ok(!gR.includes("NaN"), "no NaN in normalized object");
  assert.ok(!gR.includes("undefined"), "no undefined in JSON-serialized object");

  const noUnc = U.normalizeFireDetection(
    { lat: 1, lon: 2, frp: 9 },
    { sourceId: "nasa-firms" },
  );
  assert.equal(noUnc.frpUncertaintyMw, null);
  assert.equal(noUnc.brightTi4K, null);
  assert.equal(noUnc.qualityFlags, null);
  assert.equal(noUnc.detectedAt, null);

  const backward = U.clusterFires([
    U.normalizeFireDetection({ lat: 39, lon: 35, frp: 70, detectedAt: "2026-08-01T08:00:00Z", acq_time: "0" }, { sourceId: "nasa-firms", source: "NASA FIRMS" }),
    U.normalizeFireDetection({ lat: 39.01, lon: 35.01, frp: 40, detectedAt: "2026-08-01T10:00:00Z" }, { sourceId: "nasa-firms", source: "NASA FIRMS" }),
  ]);
  assert.equal(backward.length, 1);
  assert.equal(backward[0].maxFrp, 70, "legacy maxFrp preserved from normalized input");
  assert.equal(backward[0].count, 2);
  } finally {
    A.CONFIG.activeCountryCode = prevCountry;
  }
});

test("adaptive corridor stays in its documented 10–30 km range", () => {
  assert.equal(U.adaptiveCorridorDistanceKm(0, 0), 10);
  assert.equal(U.adaptiveCorridorDistanceKm(300, 35), 30);
  assert.ok(U.adaptiveCorridorDistanceKm(100, 15) > 10);
});

test("export metadata and filenames are bilingual while machine keys remain stable", () => {
  let download;
  const original = U.download;
  U.download = (name, type, content) => {
    download = { name, type, content };
  };
  I.locale = "en";
  A.CONFIG.activeCountryCode = "FR";
  const state = {
    countryCode: "FR",
    selectedTime: new Date("2026-08-01T00:00:00Z"),
    fireData: [],
    fireEvents: [],
    fireImpacts: [],
    smokeData: [],
    windData: [],
    surfaceWindData: [],
  };
  A.ExportManager.json(state);
  assert.match(download.name, /^gridrisk-atlas_FR_\d{4}-\d{2}-\d{2}\.json$/);
  const parsed = JSON.parse(download.content);
  assert.equal(parsed.metadata.applicationName, "GridRisk Atlas");
  assert.equal(parsed.metadata.language, "en");
  assert.equal(parsed.metadata.countryCode, "FR");
  for (const key of [
    "countryCode",
    "riskScore",
    "actualVoltageKv",
    "gridClass",
    "displayLabel",
  ])
    assert.ok(source.export.includes(key));
  U.download = original;
  I.locale = "tr";
});

test("language switch path contains no adapter call", () => {
  const body =
    source.i18n.match(/setLanguage\(value\)[\s\S]*?onChange\(handler\)/)?.[0] ||
    "";
  assert.equal(/fetch\(|OpenMeteo|FirmsAdapter|loadGroup/.test(body), false);
});

test("brand fallback and click behavior preserve country, language and map position", () => {
  assert.match(html, /id="brandHomeLink"[\s\S]*?href=""/);
  assert.ok(source.ui.includes("I.url(code)"));
  assert.ok(source.ui.includes('this.showView("map")'));
  assert.ok(source.ui.includes("this.closeDetail(true)"));
  assert.equal(
    /setView\(|fitBounds\(/.test(
      source.ui.match(/brandHomeLink[\s\S]*?languageSelector/)?.[0] || "",
    ),
    false,
  );
});

test("responsive layer body moves without cloning and is invoked on resize", () => {
  assert.ok(source.ui.includes("syncLayerPanelPlacement()"));
  assert.ok(source.ui.includes("target.appendChild(body)"));
  assert.ok(source.ui.includes("body.parentElement !== target"));
  assert.ok(source.app.includes("this.ui.syncLayerPanelPlacement()"));
  assert.ok(source.app.includes('window.addEventListener("orientationchange"'));
});

test("wind endpoint is a non-interactive arrow and no start circle is added", () => {
  const body =
    source.map.match(/drawWindVector\([\s\S]*?clearWindVector\(/)?.[0] || "";
  assert.ok(body.includes("windDirectionArrow"));
  assert.ok(body.includes("interactive: false"));
  assert.equal(body.includes("circleMarker"), false);
});

test("production layer defaults match the UX contract", () => {
  const checked = (id) => new RegExp(`id="${id}"[^>]*checked`).test(html);
  assert.equal(checked("layerGridMaster"), true);
  assert.equal(checked("layerThermalEnvelope"), true);
  assert.equal(checked("layerEffisBurntArea"), true);
  assert.equal(checked("layerSmoke"), false);
  assert.equal(checked("layerWind"), false);
  assert.equal(/data-grid="substations"[\s\S]{0,100}checked/.test(html), false);
  assert.equal(html.includes("Örnekleme noktaları"), false);
  assert.equal(html.includes("CAMS yangın PM10 payı"), false);
});

test("mobile/desktop layout contract is present", () => {
  assert.match(
    css,
    /\.brandIcon\s*\{[\s\S]*?width:\s*52px;[\s\S]*?height:\s*52px/,
  );
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.brandIcon\s*\{[\s\S]*?width:\s*44px/,
  );
  assert.match(css, /\.timelinePanel\s*\{[\s\S]*?480px/);
  assert.ok(css.includes("max-height: 48dvh"));
  assert.ok(css.includes("min-height: 40px"));
  assert.ok(css.includes(".layerPanel > .panelBody"));
});

test("all visible static i18n keys exist and ids are unique", () => {
  const used = [
    ...html.matchAll(
      /data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g,
    ),
  ].map((m) => m[1]);
  for (const key of used)
    assert.ok(key in A.LOCALES.tr && key in A.LOCALES.en, `missing ${key}`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("target JavaScript files contain no hardcoded Turkish UI strings", () => {
  const targets = ["app", "ui", "map", "grid", "api", "export", "countries"];
  const allowlist = [/Türkiye/g];
  for (const name of targets) {
    let text = source[name];
    for (const allowed of allowlist) text = text.replace(allowed, "");
    assert.equal(
      /[ÇĞİÖŞÜçğıöşü]/.test(text),
      false,
      `${name}.js contains Turkish UI text`,
    );
  }
});

test("no old product or old Pages base path remains in production files", () => {
  const files = [
    "index.html",
    "manifest.webmanifest",
    "package.json",
    ...Object.keys(source).map((name) => `js/${name}.js`),
    ".github/workflows/pages.yml",
  ];
  for (const file of files) {
    const text = read(file);
    assert.equal(
      /GridMoni|Wildfire Grid Risk Monitor|\/tr_wildfire\//.test(text),
      false,
      file,
    );
  }
});

test("mobile quick layer menu contract (FAB, 2x2 popover, checkbox sync)", () => {
  const targets = ["layerMtg", "layerFrpHeat", "layerSmoke", "layerGridMaster"];
  assert.ok(html.includes('id="quickLayersFab"'));
  assert.ok(html.includes('id="quickLayersPopover"'));
  assert.ok(html.includes('id="quickLayersAll"'));
  const btns = [
    ...html.matchAll(
      /class="quickLayerBtn"[\s\S]*?data-quick-layer="([^"]+)"/g,
    ),
  ].map((m) => m[1]);
  assert.deepEqual(btns, targets);
  for (const id of targets) {
    assert.ok(html.includes(`<input id="${id}"`), id + " checkbox");
    assert.equal(
      (html.match(new RegExp(`id="${id}"`, "g")) || []).length,
      1,
      id + " unique",
    );
  }
  for (const key of [
    "quickLayers.fabLabel",
    "quickLayers.fabAria",
    "quickLayers.satellite",
    "quickLayers.heat",
    "quickLayers.smoke",
    "quickLayers.grid",
    "quickLayers.all",
  ])
    assert.ok(key in A.LOCALES.tr && key in A.LOCALES.en, key);
  assert.equal(A.LOCALES.tr["quickLayers.fabLabel"], "Katmanlar");
  assert.equal(A.LOCALES.en["quickLayers.fabLabel"], "Layers");
  assert.ok(html.includes('role="group"'));
  assert.ok(!html.includes("menuitemcheckbox"));
  assert.ok(!html.includes("Katmanlar / Layers"));
  assert.match(source.ui, /input\.click\(\)/);
  assert.ok(!source.ui.includes("input.checked = !input.checked"));
  assert.ok(
    !source.ui.includes('dispatchEvent(new Event("change", { bubbles: true }))'),
  );
  assert.match(source.ui, /aria-pressed/);
  assert.match(source.ui, /closeQuickLayers\(\)/);
  assert.match(source.ui, /popstate/);
  assert.match(source.ui, /Escape/);
  assert.match(source.ui, /pointerdown/);
  assert.match(source.ui, /syncQuickLayers\(\)/);
  assert.match(source.ui, /orientationchange/);
  assert.match(source.ui, /addEventListener\("resize"/);
  assert.match(source.ui, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source.ui, /loading\?\.size/);
  assert.match(source.ui, /"error"/);
  assert.match(css, /\.quickLayersFab/);
  assert.match(css, /\.quickLayersPopover\s*\{\s*display: none/s);
  assert.match(css, /\.quickLayersPopover:not\(\.hidden\)/);
  assert.match(css, /\.quickLayerBtn\.warn/);
  assert.match(css, /max-width: 190px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /min-width: 48px/);
  assert.match(css, /max-width: 760px/);
});

test("nearby FIRMS contract (10 km radius, FRP >= 1 list filter)", () => {
  assert.equal(A.CONFIG.NEARBY_FIRMS_RADIUS_KM, 10);
  assert.match(source.app, /x\.distance <= C\.NEARBY_FIRMS_RADIUS_KM/);
  assert.ok(!/x\.distance <= 100/.test(source.app));
  assert.match(source.ui, /Number\(item\.fire\?\.frp\) >= 1/);
  assert.equal(A.LOCALES.tr["detail.nearbyFirms"].includes("10 km"), true);
  assert.equal(A.LOCALES.en["detail.nearbyFirms"].includes("10 km"), true);
  assert.equal(A.LOCALES.tr["detail.nearbyFirms"].includes("100 km"), false);
  assert.equal(A.LOCALES.en["detail.nearbyFirms"].includes("100 km"), false);
  assert.equal(A.LOCALES.tr["detail.nearbyCount"], "10 km FIRMS");
  assert.equal(A.LOCALES.en["detail.nearbyCount"], "10 km FIRMS");
  assert.ok("detail.nearbyEmpty" in A.LOCALES.tr && "detail.nearbyEmpty" in A.LOCALES.en);
});

test("sparkline series selection (48h window, FRP >= 5, 12x4h buckets, peak kept)", () => {
  const end = Date.UTC(2026, 7, 3, 12, 0, 0);
  const mk = (id, h, frp) => ({
    id,
    detectedAt: new Date(end - h * 3600e3).toISOString(),
    frp,
  });
  const dets = [
    mk("below", 47, 4.9),
    mk("edge", 46, 5.0),
    mk("old", 49, 50),
    mk("future", -1, 30),
    mk("b48", 48, 60),
    mk("e", 24, 20),
    mk("f", 12, 40),
    mk("g", 1, 25),
  ];
  const out = A.Utils.sparklinePoints(dets, { endMs: end });
  assert.deepEqual(
    out.map((x) => x.id),
    ["b48", "edge", "e", "f", "g"],
  );
  const twelve = [];
  for (let i = 0; i < 12; i++) twelve.push(mk(`b${i}`, 0.5 + i * 4, 10 + i));
  const b12 = A.Utils.sparklinePoints(twelve, { endMs: end, maxPoints: 12 });
  assert.equal(b12.length, 12, "one detection per 4h bucket fills all 12");
  const same = A.Utils.sparklinePoints([mk("s1", 1, 10), mk("s2", 1.5, 20)], {
    endMs: end,
    maxPoints: 12,
  });
  assert.equal(same.length, 1, "same-bucket detections collapse");
  assert.equal(same[0].frp, 20, "bucket keeps max FRP");
  const many = [];
  for (let i = 0; i < 100; i++) many.push(mk(`d${i}`, i * 0.4, 5 + (i % 7)));
  const maxP = many.reduce(
    (best, x) => (Number(x.frp) > Number(best.frp) ? x : best),
    many[0],
  );
  const down = A.Utils.sparklinePoints(many, { endMs: end, maxPoints: 12 });
  assert.ok(down.length <= 12, "downsampled to <= 12 buckets");
  assert.ok(down.length > 0);
  assert.ok(down.some((x) => x.id === maxP.id), "global max point kept");
  const ts = down.map((x) => Date.parse(x.detectedAt));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), "chronological order");
  const zero = A.Utils.sparklinePoints([], { endMs: end });
  assert.equal(zero.length, 0);
});

test("fire event tooltip compact contract (single bindTooltip, 12x4h, real labels, no peak)", () => {
  const tooltip = source.map
    .split("firesEventTooltip(ev, history, reference, opts = {}) {")[1]
    .split("fireSparklineData(ev, reference) {")[0];
  assert.match(tooltip, /summary\.detections/);
  assert.match(tooltip, /sparkline\.title/);
  assert.match(tooltip, /sparkline\.empty/);
  assert.match(tooltip, /"fire-popup-metrics"/);
  assert.match(tooltip, /analysis\.maxFrp/);
  assert.match(tooltip, /sparkline\.firstLast/);
  assert.match(tooltip, /sparkline\.lastSeen/);
  assert.match(tooltip, /map\.viewDetails/);
  assert.match(tooltip, /opts\.withDetails/);
  assert.ok(!tooltip.includes("map.peakTime"), "no Tepe zamanı row");
  assert.ok(!tooltip.includes("map.lastAgeLabel"), "no lastAgeLabel row");
  assert.ok(!tooltip.includes("map.areaCount"), "no Bölgedeki tespit line");
  assert.ok(!tooltip.includes("detail.first"), "single İlk / Son row");
  const src = source.map
    .split("fireSparklineData(ev, reference) {")[1]
    .split("fireFrpChart(spark) {")[0];
  assert.match(src, /this\.fireAll\.filter/);
  assert.ok(!src.includes("ev.members"), "chart source is fireAll, not ev.members");
  assert.match(src, /NEARBY_FIRMS_RADIUS_KM/);
  assert.match(src, /minFrp: 5/);
  assert.match(src, /maxPoints: 12/);
  assert.match(src, /_sparkCache/);
  assert.ok(!src.includes("peakFrp"), "no peakFrp field");
  assert.ok(!src.includes("peakTime"), "no peakTime field");
  assert.match(src, /maxFrp: Math\.max/);
  const chart = source.map
    .split("fireFrpChart(spark) {")[1]
    .split("substationIcon() {")[0];
  assert.match(chart, /buckets = 12/);
  assert.match(chart, /bucketMs = 4 \* 3600e3/);
  assert.match(chart, /barW = 9/);
  assert.match(chart, /minH = 5/);
  assert.match(chart, /viewBox="0 0 \$\{W\} \$\{H\}"/);
  assert.match(chart, /role="img"/);
  assert.match(chart, /aria-hidden="true"/);
  assert.match(chart, /fire-frp-bars/);
  assert.match(chart, /formatCompactHour/);
  assert.match(chart, /sparkline\.now/);
  assert.match(chart, /<line/);
  assert.match(chart, /#e5edf3/);
  assert.ok(!chart.includes("fire-frp-peak"), "no peak overlay");
  assert.ok(!chart.includes("<circle"), "no peak dot");
  assert.ok(!chart.includes("sparkline.peak"), "no peak label");
  assert.ok(!chart.includes("sparkline.aria"), "no peak aria");
  assert.ok(!chart.includes("sparkline.from"), "no fixed −48h label");
  assert.ok(!chart.includes("#e25c1f"), "no peak color");
  const binding = source.map
    .split("const tooltipOptions = {")[1]
    .split("m.addTo(this.fireLayer)")[0];
  assert.match(binding, /className: "fire-event-tooltip"/);
  assert.match(binding, /direction: "top"/);
  assert.match(binding, /offset: L\.point\(0, -8\)/);
  assert.match(binding, /opacity: 0\.97/);
  assert.match(binding, /sticky: false/);
  assert.match(binding, /permanent: false/);
  assert.match(binding, /interactive: false/);
  assert.match(binding, /pointer: coarse/);
  assert.match(binding, /maxWidth: 236/);
  assert.ok(!source.map.includes("● ${count}"), "zoom<7 rebind removed");
  assert.ok(!source.map.includes("getTooltip().getContent()"), "single bindTooltip only");
  assert.ok(
    !source.map.includes("fireClustering.radiusKm"),
    "no pixel radius into areaHistory",
  );
  assert.match(
    source.map,
    /U\.areaHistory\(this\.fireAll, ev, C\.NEARBY_FIRMS_RADIUS_KM\)/,
  );
  assert.match(
    source.map,
    /U\.areaHistory\(this\.fireAll, f, C\.NEARBY_FIRMS_RADIUS_KM\)/,
  );
  assert.match(source.utils, /sparklinePoints\(detections,opts=\{}\)\{/);
  assert.match(source.utils, /formatCompactDateTime\(date\)/);
  assert.match(source.utils, /formatCompactHour\(date\)/);
  assert.match(source.utils, /formatAgeShort\(iso,reference=new Date\(\)\)/);
  for (const key of [
    "sparkline.title",
    "sparkline.empty",
    "sparkline.now",
    "sparkline.firstLast",
    "sparkline.lastSeen",
    "sparkline.ago",
    "map.viewDetails",
    "duration.dayShort",
    "duration.hourShort",
    "duration.minuteShort",
  ])
    assert.ok(key in A.LOCALES.tr && key in A.LOCALES.en, key);
  for (const key of [
    "sparkline.peak",
    "sparkline.from",
    "sparkline.aria",
    "map.peakTime",
    "map.lastAgeLabel",
  ])
    assert.ok(!(key in A.LOCALES.tr) && !(key in A.LOCALES.en), `${key} removed`);
  assert.equal(A.LOCALES.tr["sparkline.title"], "FRP · son 48 saat");
  assert.equal(A.LOCALES.en["sparkline.title"], "FRP · last 48 hours");
  assert.equal(A.LOCALES.tr["sparkline.empty"], "Son 48 saatte FRP ≥ 5 MW tespiti yok.");
  assert.equal(A.LOCALES.en["sparkline.empty"], "No FRP ≥ 5 MW detections in the last 48 hours.");
  assert.equal(A.LOCALES.tr["sparkline.firstLast"], "İlk / Son");
  assert.equal(A.LOCALES.en["sparkline.firstLast"], "First / Last");
  assert.equal(A.LOCALES.tr["sparkline.lastSeen"], "Son tespit");
  assert.equal(A.LOCALES.en["sparkline.lastSeen"], "Last seen");
  assert.equal(A.LOCALES.tr["sparkline.ago"], "{age} önce");
  assert.equal(A.LOCALES.en["sparkline.ago"], "{age} ago");
  assert.equal(A.LOCALES.tr["map.viewDetails"], "Detayı Aç");
  assert.equal(A.LOCALES.en["map.viewDetails"], "View Details");
  assert.equal(A.LOCALES.tr["duration.hourShort"], "{count} sa");
  assert.equal(A.LOCALES.en["duration.hourShort"], "{count} h");
  assert.equal(A.LOCALES.tr["duration.minuteShort"], "{count} dk");
  assert.equal(A.LOCALES.en["duration.minuteShort"], "{count} min");
});

test("fire event tooltip CSS (no scroll, compact chart, popup close target)", () => {
  assert.match(
    css,
    /\.leaflet-tooltip\.fire-event-tooltip \{\s*width: 236px;\s*max-width: calc\(100vw - 24px\);\s*max-height: none;\s*overflow: visible;\s*white-space: normal;\s*padding: 9px 10px;\s*font-size: 12px;\s*line-height: 1\.3;/,
  );
  assert.match(css, /\.fire-frp-chart \{\s*position: relative;\s*width: 100%;\s*height: 52px;/);
  assert.match(css, /\.fire-popup-metrics \{\s*display: grid;\s*grid-template-columns: auto 1fr;/);
  assert.match(
    css,
    /\.leaflet-popup\.fire-event-popup \.leaflet-popup-close-button \{[^}]*width: 40px;[^}]*height: 40px;[^}]*min-width: 40px;[^}]*min-height: 40px;/,
  );
  assert.match(css, /\.leaflet-popup\.fire-event-popup \.leaflet-popup-content \{[^}]*width: 236px !important;/);
  assert.match(css, /\.fire-frp-bars/);
  assert.match(css, /\.fire-event-detail/);
  const fireCss = css
    .split("/* v3.7.1 fire event tooltip & popup")[1]
    .split("/* v3.7.0 mobile quick layer menu")[0];
  assert.ok(!fireCss.includes(".fire-frp-peak"), "no peak overlay css");
  assert.ok(!fireCss.includes("max-height: 230px"), "no old scroll cap");
  assert.ok(!fireCss.includes("overflow-y"), "no vertical scrollbar in fire rules");
  assert.ok(!css.includes(".fireSparkline"), "old .fireSparkline rule removed");
});

test("mobile quick layer ARIA contract (controls, group label, warning labels)", () => {
  assert.match(html, /aria-controls="quickLayersPopover"/);
  assert.equal(html.includes('aria-haspopup="menu"'), false);
  assert.match(html, /data-i18n-aria-label="quickLayers\.groupAria"/);
  assert.match(html, /id="quickLayersPopover"[\s\S]*?role="group"/);
  assert.match(source.ui, /const warningStates = new Set\(\["error", "warn", "stale", "partial"\]\)/);
  assert.match(source.ui, /aria-label", aria/);
  assert.match(source.ui, /T\("quickLayers\.loading"\)/);
  assert.match(source.ui, /T\("quickLayers\.warning"\)/);
  assert.ok("quickLayers.groupAria" in A.LOCALES.tr && "quickLayers.groupAria" in A.LOCALES.en);
  assert.ok("quickLayers.loading" in A.LOCALES.tr && "quickLayers.loading" in A.LOCALES.en);
  assert.ok("quickLayers.warning" in A.LOCALES.tr && "quickLayers.warning" in A.LOCALES.en);
});

test("all local production asset references resolve", () => {
  const refs = [
    ...html.matchAll(/(?:src|href)="((?!https?:|#)[^"?]+)(?:\?[^"#]*)?"/g),
  ]
    .map((m) => m[1])
    .filter(Boolean);
  for (const ref of refs) assert.equal(statSync(ref).isFile(), true, ref);
  for (const icon of manifest.icons)
    assert.equal(statSync(icon.src).isFile(), true, icon.src);
});

test("thermal source registry contracts (config defaults, adapter registration, FIRMS passthrough)", async () => {
  const TS = A.ThermalSources,
    registry = TS.registry;
  assert.ok(registry, "registry exposed");
  assert.deepEqual(
    [...registry.list()].map((a) => a.id),
    ["nasa-firms"],
  );
  const firms = registry.get("nasa-firms");
  assert.equal(firms.label, "NASA FIRMS");
  assert.equal(firms.sensorFamily, "viirs-modis");
  assert.equal(firms.supportsFrp, true);
  assert.equal(firms.supportsUncertainty, false);
  assert.equal(firms.defaultEnabled, true);
  assert.equal(typeof firms.discover, "function");
  assert.equal(typeof firms.load, "function");
  assert.equal(registry.get("mtg-fci-frp"), null);
  await assert.rejects(() => registry.load("mtg-fci-frp", {}), /unknown source/);

  const cfg = A.CONFIG.thermalSources;
  assert.equal(cfg.mode, "FIRMS_ONLY");
  assert.deepEqual(cfg.enabled, {
    firms: true,
    sentinel3a: false,
    sentinel3b: false,
    mtg: false,
    msg: false,
  });
  assert.equal(A.CONFIG.thermalFusion.enabled, false);
  assert.deepEqual(A.CONFIG.thermalFusion.association.viirsToSlstr, {
    maxDistanceKm: 2.5,
    maxTimeMinutes: 90,
  });
  assert.deepEqual(A.CONFIG.thermalFusion.association.viirsToMtg, {
    maxDistanceKm: 4,
    maxTimeMinutes: 30,
  });
  assert.deepEqual(A.CONFIG.thermalFusion.association.slstrToMtg, {
    maxDistanceKm: 4,
    maxTimeMinutes: 45,
  });
  const legacy = A.CONFIG.thermal;
  assert.equal(legacy.mode, "FIRMS_ONLY");
  assert.equal(legacy.fusion.enabled, false);
  assert.equal(legacy.sources["nasa-firms"].enabled, true);
  assert.equal(legacy.sources["nasa-firms"].required, true);
  assert.equal(legacy.sources["sentinel3a-slstr"].featureFlag, true);
  assert.equal(legacy.sources["sentinel3a-slstr"].enabled, false);
  assert.equal(legacy.sources["sentinel3b-slstr"].featureFlag, true);
  assert.equal(legacy.sources["msg-seviri-frp"].enabled, false);
  assert.equal(registry.isEnabled("nasa-firms"), true);
  assert.equal(registry.isEnabled("sentinel3a-slstr"), false);

  const fixtures = [
    { lat: 38.6, lon: 35.2, detectedAt: "2026-08-02T10:00:00Z", frp: 45, product: "VIIRS_NOAA21_NRT", satellite: "NOAA-21", source: "NASA FIRMS" },
    { lat: 38.6, lon: 35.2, detectedAt: "2026-08-02T10:00:00Z", frp: 55, product: "V_NRT", satellite: "NOAA-21", source: "NASA FIRMS" },
  ];
A.FirmsAdapter = {
    load: async () => fixtures,
    source: async () => "AUTO",
    setSource: () => {},
    isAuto: () => true,
  };
  const out = await registry.load("nasa-firms", { bbox: "", countryCode: "TR" });
  assert.equal(out, fixtures, "passthrough returns the exact FirmsAdapter result");

  const st = TS.state("nasa-firms");
  assert.equal(st.status, "idle");
  TS.setLoading("nasa-firms", 1);
  assert.equal(TS.state("nasa-firms").status, "loading");
  assert.equal(TS.setResult("nasa-firms", 1, fixtures, 12, "req"), true);
  assert.equal(TS.state("nasa-firms").status, "ok");
  assert.equal(TS.state("nasa-firms").count, 2);
  assert.equal(TS.setResult("nasa-firms", 2, [], 5, "req2"), false, "stale seq ignored");
  const expectConnected = A.I18n.locale === "en" ? "Connected" : "Bağlı";
  assert.equal(TS.statusLabel("ok"), expectConnected);

  for (const key of ["idle", "loading", "ok", "empty", "error", "stale"])
    assert.ok(TS.SOURCE_STATES.includes(key));
  assert.equal(TS.SOURCE_STATES.includes("warn"), true);
});

test("thermal: default mode FIRMS_ONLY preserved in config and no fusion wiring in app", () => {
  assert.equal(A.CONFIG.thermalSources.mode, "FIRMS_ONLY");
  assert.equal(A.CONFIG.thermalFusion.enabled, false);
  assert.equal(A.CONFIG.thermal.mode, "FIRMS_ONLY", "legacy alias stays in sync");
  assert.equal(A.CONFIG.thermal.fusion.enabled, false);
  const hasFusionWiring = /associateAcrossSources|loadThermalSources/.test(
    source.app,
  );
  assert.equal(hasFusionWiring, false, "no fusion flow before its dedicated commit");
});

test("icon variants have the required PNG dimensions", async () => {
  const expected = [16, 32, 48, 192, 512];
  for (const size of expected) {
    const data = readFileSync(`assets/icons/gridrisk-atlas-${size}.png`);
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
  }
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}\n  ${error.message}`);
  }
}
console.log(`\n${passed}/${tests.length} tests passed`);
if (passed !== tests.length) process.exit(1);
