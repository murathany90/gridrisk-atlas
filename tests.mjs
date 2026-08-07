import { readFileSync, readdirSync, statSync } from "fs";
import { strict as assert } from "assert";
import vm from "vm";
import { spawn } from "node:child_process";

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
  "js/eumetview-wfs.js",
  "js/thermal-sources.js",
  "js/thermal-association.js",
  "js/map.js",
  "js/export.js",
])
  vm.runInThisContext(read(path), { filename: path });

const A = global.AtmoApp;
const I = A.I18n;
const U = A.Utils;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("brand, subtitle and v3.11.2 are synchronized", () => {
  assert.equal(A.CONFIG.appName, "GridRisk Atlas");
  assert.equal(A.CONFIG.appVersion, "3.11.2");
  assert.equal(pkg.name, "gridrisk-atlas");
  assert.equal(pkg.version, "3.11.2");
  assert.equal(document.title.includes("GridRisk Atlas"), true);
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

test("six countries expose localized names, coverage and correct timezones", () => {
  const zones = {
    TR: "Europe/Istanbul",
    ES: "Europe/Madrid",
    FR: "Europe/Paris",
    PT: "Europe/Lisbon",
    IT: "Europe/Rome",
    GR: "Europe/Athens",
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
    ["nasa-firms", "sentinel3a-slstr", "sentinel3b-slstr", "mtg-fci-frp"],
  );
  const firms = registry.get("nasa-firms");
  assert.equal(firms.label, "NASA FIRMS");
  assert.equal(firms.sensorFamily, "viirs-modis");
  assert.equal(firms.supportsFrp, true);
  assert.equal(firms.supportsUncertainty, false);
  assert.equal(firms.defaultEnabled, true);
  assert.equal(typeof firms.discover, "function");
  assert.equal(typeof firms.load, "function");
  const mtgAdapter = registry.get("mtg-fci-frp");
  assert.ok(mtgAdapter, "mtg-fci-frp registered after its dedicated commit");
  assert.equal(mtgAdapter.defaultEnabled, false);
  assert.equal(registry.isEnabled("mtg-fci-frp"), true, "MTG enabled after successful EUMETView probe");

  const cfg = A.CONFIG.thermalSources;
  assert.equal(cfg.mode, "SEPARATE_SOURCES");
  assert.deepEqual(cfg.enabled, {
    firms: true,
    sentinel3a: true,
    sentinel3b: true,
    mtg: true,
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
  assert.equal(legacy.mode, "SEPARATE_SOURCES");
  assert.equal(legacy.fusion.enabled, false);
  assert.equal(legacy.sources["nasa-firms"].enabled, true);
  assert.equal(legacy.sources["nasa-firms"].required, true);
  assert.equal(legacy.sources["sentinel3a-slstr"].featureFlag, true);
  assert.equal(legacy.sources["sentinel3a-slstr"].enabled, true);
  assert.equal(legacy.sources["sentinel3b-slstr"].featureFlag, true);
  assert.equal(legacy.sources["sentinel3b-slstr"].enabled, true);
  assert.equal(legacy.sources["msg-seviri-frp"].enabled, false);
  assert.equal(registry.isEnabled("nasa-firms"), true);
  assert.equal(registry.isEnabled("sentinel3a-slstr"), true);
  assert.equal(registry.isEnabled("sentinel3b-slstr"), true);

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
  for (const key of ["disabled", "partial", "unavailable"])
    assert.ok(TS.SOURCE_STATES.includes(key), `SOURCE_STATES includes ${key}`);
});

test("thermal: computeThermalMetrics computes deduplicated/threshold/visible/latest counts", () => {
  const TS = A.ThermalSources;
  const detections = [
    { lat: 39, lon: 35, frp: 45, detectedAt: "2026-08-02T08:00:00Z" },
    { lat: 39.1, lon: 35.1, frp: 12, detectedAt: "2026-08-02T09:00:00Z" },
    { lat: 39.2, lon: 35.2, frp: null, detectedAt: "2026-08-02T10:00:00Z" },
    { lat: 39.3, lon: 35.3, frp: 90, detectedAt: "2026-08-02T11:00:00Z" },
    { lat: 39.4, lon: 35.4, frp: 31, detectedAt: "2026-08-02T23:00:00Z" },
  ];
  const m = TS.computeThermalMetrics(detections, {
    frpThreshold: 30,
    visibleWindow: new Date("2026-08-03T00:00:00Z"),
  });
  assert.equal(m.deduplicatedCount, 5);
  assert.equal(m.thresholdCount, 3, "frp >= 30 counted; null frp ignored");
  assert.equal(m.visibleCount, 5, "all within the 24h visible window");
  assert.equal(m.latestObservationAt, "2026-08-02T23:00:00Z");
  const outsideWindow = TS.computeThermalMetrics(detections.slice(0, 2), {
    frpThreshold: 30,
    visibleWindow: new Date("2026-08-10T00:00:00Z"),
  });
  assert.equal(outsideWindow.visibleCount, 0, "no detections in window");
  const empty = TS.computeThermalMetrics([], { frpThreshold: 30 });
  assert.deepEqual(empty, {
    rawCount: 0,
    validCount: 0,
    deduplicatedCount: 0,
    thresholdCount: 0,
    visibleCount: 0,
    confirmedEventCount: null,
    latestObservationAt: null,
  }, "successful empty results show 0 for known counters, null for unknown");
  const noWindow = TS.computeThermalMetrics(detections.slice(0, 1));
  assert.equal(noWindow.visibleCount, null, "visibleCount stays null without window");
});

test("thermal: empty vs error vs disabled row statuses stay distinct", () => {
  const TS = A.ThermalSources;
  const prevMode = TS.getMode();
  TS.setMode("SEPARATE_SOURCES");
  try {
    TS.patchState("sentinel3a-slstr", {
      status: "empty",
      data: [],
      lastSuccessfulAt: new Date().toISOString(),
      metrics: { ...TS.defaultMetrics(), rawCount: 0, validCount: 0, deduplicatedCount: 0, thresholdCount: 0, visibleCount: 0 },
    });
    TS.patchState("sentinel3b-slstr", {
      status: "error",
      error: "HTTP 500",
      metrics: TS.defaultMetrics(),
    });
    TS.patchState("nasa-firms", {
      status: "ok",
      products: {
        VIIRS_NOAA21_NRT: { status: "ok", count: 7, metrics: { ...TS.defaultMetrics(), deduplicatedCount: 7, thresholdCount: 2, latestObservationAt: "2026-08-02T10:00:00Z" } },
        VIIRS_NOAA20_NRT: { status: "empty", count: 0, metrics: { ...TS.defaultMetrics(), deduplicatedCount: 0, thresholdCount: 0, visibleCount: 0, latestObservationAt: null } },
        VIIRS_SNPP_NRT: { status: "error", error: "timeout", metrics: TS.defaultMetrics() },
      },
    });
    const rows = {};
    for (const r of TS.thermalRows()) rows[r.id] = r;
    assert.equal(rows["sentinel3a-slstr"].status, "empty", "empty is not an error");
    assert.equal(rows["sentinel3a-slstr"].metrics.deduplicatedCount, 0, "empty success shows 0");
    assert.equal(rows["sentinel3a-slstr"].metrics.latestObservationAt, null, "unknown metric stays null");
    assert.equal(rows["sentinel3b-slstr"].status, "error");
    assert.equal(rows["mtg-fci-frp"].status !== "disabled", true, "mtg enabled after probe");
    assert.equal(rows["viirs-noaa21"].status, "ok");
    assert.equal(rows["viirs-noaa20"].status, "empty", "zero records are empty, not error");
    assert.equal(rows["viirs-snpp"].status, "error");
    assert.equal(rows["viirs-noaa21"].metrics.deduplicatedCount, 7);
    assert.equal(rows["viirs-noaa21"].metrics.thresholdCount, 2);
    assert.equal(rows["viirs-noaa20"].metrics.deduplicatedCount, 0, "successful empty product shows 0, not null");
    assert.equal(rows["viirs-noaa20"].metrics.latestObservationAt, null, "unknown metric stays null");
    assert.equal(rows["modis"].status, "disabled", "MODIS manual-only is disabled under AUTO");
    assert.equal(rows["modis"].note.includes("Manuel"), true, "MODIS shows Manual selection note");
    TS.setMode("FIRMS_ONLY");
    const rowsFirmsOnly = {};
    for (const r of TS.thermalRows()) rowsFirmsOnly[r.id] = r;
    assert.equal(rowsFirmsOnly["sentinel3a-slstr"].status, "disabled");
    assert.equal(rowsFirmsOnly["mtg-fci-frp"].status, "disabled");
    assert.equal(rowsFirmsOnly["multi-sensor"].status, "disabled");
  } finally {
    TS.setMode(prevMode);
  }
});

test("thermal: MODIS role follows the selected firms source", () => {
  const TS = A.ThermalSources;
  const prevSource = A.FirmsAdapter.source;
  try {
    A.FirmsAdapter.source = () => "AUTO";
    let rows = {};
    for (const r of TS.thermalRows()) rows[r.id] = r;
    assert.equal(
      rows.modis.riskRoleKey,
      "thermal.role.verificationManual",
      "AUTO keeps MODIS in the manual verification role",
    );
    A.FirmsAdapter.source = () => "MODIS_NRT";
    rows = {};
    for (const r of TS.thermalRows()) rows[r.id] = r;
    assert.equal(
      rows.modis.riskRoleKey,
      "thermal.role.primaryManual",
      "MODIS_NRT elevates MODIS to the manual primary role",
    );
    assert.equal(rows["viirs-noaa21"].riskRoleKey, "thermal.role.primary", "VIIRS role unchanged");
    assert.equal(rows["sentinel3a-slstr"].riskRoleKey, "thermal.role.verification", "SLSTR role unchanged");
  } finally {
    A.FirmsAdapter.source = prevSource;
  }
  const tr = read("js/locales/tr.js");
  const en = read("js/locales/en.js");
  for (const key of ["thermal.role.primaryManual", "thermal.role.verificationManual"]) {
    assert.ok(tr.includes(key), `${key} exists in tr.js`);
    assert.ok(en.includes(key), `${key} exists in en.js`);
  }
  const v = A.I18n.t("thermal.role.verificationManual");
  assert.equal(
    v,
    A.I18n.locale === "en" ? "Verification · Manual selection" : "Doğrulama · Manuel seçim",
  );
  const p = A.I18n.t("thermal.role.primaryManual");
  assert.equal(
    p,
    A.I18n.locale === "en" ? "Primary risk · Manual source" : "Ana risk · Manuel kaynak",
  );
});

test("thermal: status table rows list VIIRS products, MODIS, S3A, S3B, MTG and multi-sensor", () => {
  const TS = A.ThermalSources;
  const rows = TS.thermalRows();
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, [
    "viirs-noaa21",
    "viirs-noaa20",
    "viirs-snpp",
    "modis",
    "sentinel3a-slstr",
    "sentinel3b-slstr",
    "mtg-fci-frp",
    "multi-sensor",
  ]);
  assert.ok(rows.every((r) => r.labelKey && r.familyKey && r.riskRoleKey), "every row has label/family/risk role keys");
  const byId = {};
  for (const r of rows) byId[r.id] = r;
  assert.equal(byId["viirs-noaa21"].riskRoleKey, "thermal.role.primary");
  assert.equal(byId["viirs-snpp"].riskRoleKey, "thermal.role.primary");
  assert.equal(byId["sentinel3a-slstr"].riskRoleKey, "thermal.role.verification");
  assert.equal(byId["sentinel3b-slstr"].riskRoleKey, "thermal.role.verification");
  assert.equal(byId["mtg-fci-frp"].riskRoleKey, "thermal.role.temporal");
  assert.equal(byId["multi-sensor"].riskRoleKey, "thermal.role.derived");
  assert.equal(byId["modis"].riskRoleKey, "thermal.role.verificationManual", "MODIS role under AUTO");
  assert.equal(A.LOCALES.tr[byId["viirs-noaa21"].labelKey], "VIIRS NOAA-21");
  assert.equal(A.LOCALES.en[byId["multi-sensor"].labelKey], "Multi-sensor result");
  assert.equal(A.LOCALES.tr["thermal.status.disabled"], "Kapalı");
  assert.equal(A.LOCALES.en["thermal.status.unavailable"], "Unavailable");
});

test("thermal: MTG adapter normalizes a mock GetFeature response to the shared model", async () => {
  const TS = A.ThermalSources;
  const mtg = TS.registry.get("mtg-fci-frp");
  assert.ok(mtg, "mtg-fci-frp registered");
  const out = await withGetFeature(
    () =>
      mtg.load({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async (opts) => {
      assert.equal(opts.typeNames, "mtg_fd:frp", "probe-confirmed real layer name used");
      return {
        features: [
          {
            id: "mtg-1",
            geometry: { type: "Point", coordinates: [35.2, 39.1] },
            properties: {
              Lat: 39.1,
              Lon: 35.2,
              FRP: 55.5,
              FRPerr: 4.2,
              Confidence: 88,
              BT_mir_k: 361.2,
              BT_tir_k: 310.1,
              SZA: 42,
              time: "2026-08-01T12:00:00Z",
            },
          },
          {
            id: "mtg-2",
            geometry: { type: "Point", coordinates: [35.5, 39.5] },
            properties: {
              Lat: 39.5,
              Lon: 35.5,
              FRP: 22,
              Datetime: "2026-08-01T12:10:00Z",
            },
          },
          {
            id: "mtg-3",
            geometry: null,
            properties: { FRP: 77, time: "2026-08-01T12:20:00Z" },
          },
        ],
        pages: 1,
        totalMatched: 3,
        meta: {},
      };
    },
  );
  assert.equal(out.length, 2);
  const d = out[0];
  assert.equal(d.sourceId, "mtg-fci-frp");
  assert.equal(d.sensorFamily, "mtg");
  assert.equal(d.satellite, "MTG-I1");
  assert.equal(d.frpMw, 55.5);
  assert.equal(d.frpUncertaintyMw, 4.2);
  assert.equal(d.confidenceRaw, 88);
  assert.equal(d.brightnessTemperatureK, 361.2, "BT_mir_k preferred");
  assert.equal(d.detectedAt, "2026-08-01T12:00:00Z");
  assert.equal(d.lat, 39.1);
  assert.equal(d.lon, 35.2);
  assert.equal(out[1].detectedAt, "2026-08-01T12:10:00Z", "Datetime fallback");
  assert.equal(out.metrics.rawCount, 3, "rawCount is result.features.length");
  assert.equal(out.metrics.validCount, 2, "validCount after normalize + country filter");
  assert.equal(out.metrics.deduplicatedCount, 2, "deduplicatedCount is deduped.length");
});

test("thermal: multi-sensor metrics count families and per-product confirmations", () => {
  const TS = A.ThermalSources;
  const obs = (product, family, sourceId) => ({ product, sensorFamily: family, sourceId });
  const events = [
    { id: "e1", detectedAt: "2026-08-02T10:00:00Z", sensorFamilies: ["viirs-modis", "slstr"], supportingSources: ["nasa-firms", "sentinel3a-slstr"], observations: [obs("VIIRS_NOAA21_NRT", "viirs-modis", "nasa-firms"), obs("SLSTR L2P FRP", "slstr", "sentinel3a-slstr")] },
    { id: "e2", detectedAt: "2026-08-02T10:10:00Z", sensorFamilies: ["viirs-modis", "slstr", "mtg"], supportingSources: ["nasa-firms", "sentinel3b-slstr", "mtg-fci-frp"], observations: [obs("VIIRS_NOAA20_NRT", "viirs-modis", "nasa-firms"), obs("SLSTR L2P FRP", "slstr", "sentinel3b-slstr"), obs("MTG FCI FRP", "mtg", "mtg-fci-frp")] },
  ];
  const ms = TS.computeMultiSensorMetrics(events);
  assert.equal(ms.totalMatchedEvents, 2);
  assert.equal(ms.twoFamilyEvents, 1);
  assert.equal(ms.threePlusFamilyEvents, 1);
  assert.deepEqual(ms.familiesUsed, ["mtg", "slstr", "viirs-modis"]);
  assert.equal(ms.confirmedByProduct["VIIRS_NOAA21_NRT"], 1);
  assert.equal(ms.confirmedByProduct["VIIRS_NOAA20_NRT"], 1);
  assert.equal(ms.confirmedBySource["mtg-fci-frp"], 1);
  assert.equal(ms.confirmedBySource["sentinel3a-slstr"], 1);
  assert.equal(ms.metrics.deduplicatedCount, 2);
  assert.equal(ms.metrics.latestObservationAt, "2026-08-02T10:10:00Z");
  const msEmpty = TS.computeMultiSensorMetrics([]);
  assert.equal(msEmpty.totalMatchedEvents, 0);
  assert.equal(msEmpty.metrics.deduplicatedCount, 0, "empty multi-sensor shows 0 events");
  assert.equal(msEmpty.metrics.confirmedEventCount, 0, "empty multi-sensor shows 0 confirmed");
  assert.equal(msEmpty.metrics.latestObservationAt, null);
});

test("thermal: MTG and multi-sensor map markers use the L. prefix", () => {
  const src = read("js/map.js");
  assert.equal(
    src.includes("new CircleMarker("),
    false,
    "bare CircleMarker identifier would throw ReferenceError with real MTG data",
  );
  assert.ok(src.includes("new L.CircleMarker("), "L.CircleMarker used");
});

test("thermal: Map markers for S3, MTG, and multi-sensor drop null/non-finite FRP when threshold > 0", () => {
  const src = read("js/map.js");
  const frpCheck = "if (this.frpThreshold > 0 && (!Number.isFinite(f.frp) || f.frp < this.frpThreshold))";
  const evCheck = "if (this.frpThreshold > 0 && (!Number.isFinite(ev.maxFrpMw) || ev.maxFrpMw < this.frpThreshold))";
  assert.ok(src.includes(frpCheck), "S3/MTG filter drops non-finite FRP");
  assert.ok(src.includes(evCheck), "multi-sensor filter drops non-finite maxFrpMw");
});

const wfsS3B = JSON.parse(read("tests/fixtures/wfs-s3b.json"));

async function withGetFeature(fn, handler) {
  const orig = A.EumetviewWfs.getFeature;
  try {
    A.EumetviewWfs.getFeature = handler;
    return await fn();
  } finally {
    A.EumetviewWfs.getFeature = orig;
  }
}

test("thermal: Sentinel-3 SLSTR adapters normalize GeoJSON to the shared model", async () => {
  const TS = A.ThermalSources;
  const s3a = TS.registry.get("sentinel3a-slstr");
  const s3b = TS.registry.get("sentinel3b-slstr");
  assert.ok(s3a, "sentinel3a-slstr registered");
  assert.ok(s3b, "sentinel3b-slstr registered");
  assert.equal(s3a.sensorFamily, "slstr");
  assert.equal(s3a.supportsFrp, true);
  assert.equal(s3a.supportsUncertainty, true);
  assert.equal(s3a.defaultEnabled, false);
  assert.equal(
    TS.registry.isEnabled("sentinel3a-slstr"),
    true,
    "enabled by default under SEPARATE_SOURCES",
  );
  assert.equal(TS.registry.isEnabled("sentinel3b-slstr"), true);

  const out = await withGetFeature(
    () =>
      s3a.load({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async (opts) => {
      assert.equal(opts.typeNames, "copernicus:sentinel3a_slstr_level2_frp");
      assert.deepEqual(opts.bbox, bbox);
      return { features: wfsPage1.features, pages: 1, totalMatched: 2, cql: "", url: "", meta: {} };
    },
  );
  assert.equal(out.length, 2);
  const d = out[0];
  assert.equal(d.sourceId, "sentinel3a-slstr");
  assert.equal(d.satellite, "S3A");
  assert.equal(d.sensorFamily, "slstr");
  assert.equal(d.detectedAt, "2026-08-01T06:37:00Z");
  assert.equal(d.lat, 39.2);
  assert.equal(d.lon, 38.1);
  assert.equal(d.frpMw, 22.5);
  assert.equal(d.frpUncertaintyMw, 2.1);
  assert.equal(d.confidenceRaw, 87);
  assert.equal(d.brightnessTemperatureK, 345.1);
  assert.equal(d.pixelWidthKm, 0.94);
  assert.equal(d.pixelHeightKm, 1.12);
  assert.equal(d.qualityFlags, "UsedChannel=F1");
  assert.equal(d.dayNight, "day");
  assert.equal(d.countryCode, "TR");
  assert.equal(out[1].frpMw, 61.2);
  assert.equal(out.metrics.rawCount, 2, "SLSTR rawCount is result.features.length");
  assert.equal(out.metrics.validCount, 2, "SLSTR validCount after normalize + country filter");
  assert.equal(out.metrics.deduplicatedCount, 2, "SLSTR deduplicatedCount is deduped.length");
});

test("thermal: SLSTR adapter drops features outside the region and without FRP/geometry", async () => {
  const s3a = A.ThermalSources.registry.get("sentinel3a-slstr");
  const outside = {
    ...wfsPage1.features[0],
    properties: { ...wfsPage1.features[0].properties, Lat: 30.1, Lon: 10.2 },
  };
  const noTime = {
    ...wfsPage1.features[0],
    properties: { ...wfsPage1.features[0].properties, time: null, Datetime: null },
  };
  const noGeom = {
    ...wfsPage1.features[0],
    geometry: null,
    properties: { ...wfsPage1.features[0].properties, Lat: null, Lon: null },
  };
  const out = await withGetFeature(
    () =>
      s3a.load({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async () => ({ features: [outside, noTime, noGeom], pages: 1, totalMatched: 3, meta: {} }),
  );
  assert.equal(out.length, 0, "all three invalid features filtered out");
  assert.equal(out.metrics.rawCount, 3, "rawCount counts all WFS features, even filtered ones");
  assert.equal(out.metrics.validCount, 0, "validCount counts only kept detections");
  assert.equal(out.metrics.deduplicatedCount, 0);
});

test("thermal: SLSTR adapter keeps the best record when duplicates overlap in the window", async () => {
  const s3b = A.ThermalSources.registry.get("sentinel3b-slstr");
  const dup = { ...wfsS3B.features[0] };
  const out = await withGetFeature(
    () =>
      s3b.load({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async () => ({ features: [wfsS3B.features[0], dup], pages: 1, totalMatched: 2, meta: {} }),
  );
  assert.equal(out.length, 1, "same-source duplicates merged");
  assert.equal(out[0].satellite, "S3B");
  assert.equal(out[0].frpMw, 33.3);
  assert.equal(out.metrics.rawCount, 2, "rawCount is result.features.length");
  assert.equal(out.metrics.validCount, 2, "validCount after normalize + country filter, before dedup");
  assert.equal(out.metrics.deduplicatedCount, 1, "deduplicatedCount is deduped.length");
});

test("thermal: loadSlstrGroup runs both satellites in parallel and reports ok", async () => {
  const TS = A.ThermalSources;
  const calls = [];
  const res = await withGetFeature(
    () =>
      TS.loadSlstrGroup({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async (opts) => {
      calls.push(opts.typeNames);
      return {
        features: opts.typeNames.includes("3b") ? wfsS3B.features : wfsPage1.features,
        pages: 1,
        totalMatched: 2,
        meta: {},
      };
    },
  );
  assert.deepEqual(
    calls.sort(),
    ["copernicus:sentinel3a_slstr_level2_frp", "copernicus:sentinel3b_slstr_level2_frp"],
  );
  assert.equal(res.status, "ok");
  assert.equal(res.bySource.length, 2);
  assert.equal(res.merged.length, 3, "2 S3A + 1 S3B merged");
  assert.equal(TS.state("sentinel3a-slstr").status, "ok");
  assert.equal(TS.state("sentinel3a-slstr").count, 2);
  assert.equal(TS.state("sentinel3b-slstr").status, "ok");
  assert.equal(TS.state("sentinel3b-slstr").count, 1);
});

test("thermal: loadSlstrGroup warn when one satellite fails, error when both fail", async () => {
  const TS = A.ThermalSources;
  for (const id of ["sentinel3a-slstr", "sentinel3b-slstr"])
    TS.patchState(id, { status: "idle", data: null, lastSuccessfulAt: null, seq: 0 });
  const warn = await withGetFeature(
    () =>
      TS.loadSlstrGroup({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async (opts) => {
      if (opts.typeNames.includes("3a")) throw new Error("s3a down");
      return { features: wfsS3B.features, pages: 1, totalMatched: 1, meta: {} };
    },
  );
  assert.equal(warn.status, "warn");
  assert.equal(warn.merged.length, 1);
  assert.equal(warn.bySource.length, 2);
  assert.equal(TS.state("sentinel3a-slstr").status, "error");
  assert.equal(TS.state("sentinel3b-slstr").status, "ok");

  const bothFail = await withGetFeature(
    () =>
      TS.loadSlstrGroup({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async () => {
      throw new Error("view down");
    },
  );
  assert.equal(bothFail.status, "error");
  assert.equal(bothFail.merged.length, 0);
  assert.equal(TS.state("sentinel3a-slstr").status, "error");
  assert.equal(
    TS.state("sentinel3b-slstr").status,
    "stale",
    "previously-successful source degrades to stale, keeping old data",
  );
});

test("thermal: loadSlstrGroup empty when both satellites return no detections", async () => {
  const TS = A.ThermalSources;
  const res = await withGetFeature(
    () =>
      TS.loadSlstrGroup({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async () => ({ features: [], pages: 1, totalMatched: 0, meta: {} }),
  );
  assert.equal(res.status, "empty");
  assert.equal(res.merged.length, 0);
  assert.equal(TS.state("sentinel3a-slstr").status, "empty");
  assert.equal(TS.state("sentinel3b-slstr").status, "empty");
});

const mtgFixture = {
  features: [
    {
      id: "MTG_anon_2608010700_lod0.01",
      geometry: { type: "Point", coordinates: [36.2, 39.4] },
      properties: {
        Lat: 39.4,
        Lon: 36.2,
        FRP: 88.4,
        FRPerr: 6.6,
        Confidence: 3,
        BT_mir_k: 358.2,
        BT_tir_k: 295.1,
        SZA: 41.2,
        VZA: 18.7,
        Satellite: "MTG-I1",
        Datetime: "2026-08-01T08:02:33",
        time: "2026-08-01T07:10:00Z",
      },
    },
  ],
};

test("thermal: MTG FCI FRP adapter registered behind a feature flag and normalizes its own field set", async () => {
  const TS = A.ThermalSources;
  const mtg = TS.registry.get("mtg-fci-frp");
  assert.ok(mtg, "mtg-fci-frp registered");
  assert.equal(mtg.sensorFamily, "mtg");
  assert.equal(mtg.supportsFrp, true);
  assert.equal(mtg.supportsUncertainty, true);
  assert.equal(TS.registry.isEnabled("mtg-fci-frp"), true, "MTG enabled after successful probe");

  const out = await withGetFeature(
    () =>
      mtg.load({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async (opts) => {
      assert.equal(opts.typeNames, "mtg_fd:frp");
      return { features: mtgFixture.features, pages: 1, totalMatched: 1, meta: {} };
    },
  );
  assert.equal(out.length, 1);
  const d = out[0];
  assert.equal(d.sourceId, "mtg-fci-frp");
  assert.equal(d.sensorFamily, "mtg");
  assert.equal(d.satellite, "MTG-I1");
  assert.equal(d.detectedAt, "2026-08-01T07:10:00Z");
  assert.equal(d.frpMw, 88.4);
  assert.equal(d.frpUncertaintyMw, 6.6);
  assert.equal(d.brightnessTemperatureK, 358.2, "BT_mir_k preferred over BT_tir_k");
  assert.equal(d.brightTi4K, 358.2);
  assert.equal(d.confidenceRaw, 3, "MTG confidence is a long, kept raw");
  assert.equal(d.dayNight, "day");
  assert.equal(d.countryCode, "TR");
});

test("thermal: MTG adapter keeps only real WFS features inside the region", async () => {
  const mtg = A.ThermalSources.registry.get("mtg-fci-frp");
  const outside = {
    ...mtgFixture.features[0],
    properties: { ...mtgFixture.features[0].properties, Lat: 36.1, Lon: 3.2 },
  };
  const out = await withGetFeature(
    () =>
      mtg.load({
        bbox: bbox,
        countryCode: "TR",
        startTime: new Date("2026-08-01T00:00:00Z"),
        endTime: new Date("2026-08-02T00:00:00Z"),
      }),
    async () => ({ features: [outside], pages: 1, totalMatched: 1, meta: {} }),
  );
  assert.equal(out.length, 0);
});

test("thermal: runtime modes activate alternates while fusion stays config-locked until MULTI_SOURCE", () => {
  const TS = A.ThermalSources;
  assert.equal(A.CONFIG.thermalSources.mode, "SEPARATE_SOURCES");
  assert.equal(A.CONFIG.thermalFusion.enabled, false);
  assert.equal(A.CONFIG.thermal.mode, "SEPARATE_SOURCES", "legacy alias stays in sync");
  assert.equal(A.CONFIG.thermal.fusion.enabled, false);
  assert.deepEqual(TS.THERMAL_MODES, [
    "FIRMS_ONLY",
    "SEPARATE_SOURCES",
    "MULTI_SOURCE",
  ]);
  localStorage.removeItem("thermalMode");
  assert.equal(TS.getMode(), "SEPARATE_SOURCES", "localStorage unset falls back to config");
  assert.equal(TS.setMode("MULTI_SOURCE"), "MULTI_SOURCE");
  assert.equal(localStorage.getItem("thermalMode"), "MULTI_SOURCE");
  assert.equal(
    A.CONFIG.thermalFusion.enabled,
    true,
    "fusion activates at runtime only in MULTI_SOURCE",
  );
  assert.equal(TS.setMode("FIRMS_ONLY"), "FIRMS_ONLY");
  assert.equal(A.CONFIG.thermalFusion.enabled, false, "fusion deactivates outside MULTI_SOURCE");
  assert.equal(TS.setMode("BOGUS"), "SEPARATE_SOURCES", "invalid mode falls back to config default");
  assert.equal(A.CONFIG.thermalFusion.enabled, false);
  TS.setMode("SEPARATE_SOURCES");
  const appSrc = source.app;
  assert.ok(
    /loadThermalSources/.test(appSrc),
    "orchestrator wired after its dedicated commit",
  );
  const fnStart = appSrc.indexOf("async loadThermalSources()");
  assert.ok(fnStart !== -1, "loadThermalSources method exists");
  const sliced = appSrc.slice(fnStart);
  const earlyReturn = sliced.indexOf("getMode() === \"FIRMS_ONLY\"");
  const firstLoad = sliced.indexOf("loadSlstrGroup");
  assert.ok(earlyReturn !== -1, "FIRMS_ONLY short-circuits");
  assert.ok(
    earlyReturn < firstLoad,
    "FIRMS_ONLY returns before any alternate-source request",
  );
  assert.ok(/layerSentinelSlstr/.test(html), "SLSTR layer control exists");
  assert.ok(/layerMtgFrp/.test(html), "MTG FRP layer control exists");
  assert.ok(/layerMultiSensorConf/.test(html), "multi-sensor layer control exists");
  assert.ok(/thermalModeSelect/.test(html), "settings mode selector exists");
  assert.ok(/syncThermalModeUI/.test(appSrc), "mode drives UI visibility");
  assert.ok(/clearThermalAlternates/.test(appSrc), "settings mode selector exists");
});

test("icon variants have the required PNG dimensions", async () => {
  const expected = [16, 32, 48, 192, 512];
  for (const size of expected) {
    const data = readFileSync(`assets/icons/gridrisk-atlas-${size}.png`);
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
  }
});

test("thermal: FIRMS_ONLY plans zero alternate requests and never touches EUMETView", () => {
  const TS = A.ThermalSources;
  try {
    TS.setMode("FIRMS_ONLY");
    const plan = TS.planThermalRequests({
      mode: TS.getMode(),
      sentinel3a: true,
      sentinel3b: true,
    });
    assert.deepEqual(plan, { slstrIds: [], mtg: false }, "no alternate-source query in FIRMS_ONLY");
  } finally {
    TS.setMode("SEPARATE_SOURCES");
  }
});

test("thermal: SEPARATE_SOURCES plans both SLSTR satellites and MTG after probe enablement", () => {
  const TS = A.ThermalSources;
  const plan = TS.planThermalRequests({
    mode: "SEPARATE_SOURCES",
    sentinel3a: true,
    sentinel3b: true,
  });
  assert.deepEqual(plan.slstrIds, ["sentinel3a-slstr", "sentinel3b-slstr"]);
  assert.equal(plan.mtg, true, "MTG planned once enabled by config (probe verified)");
  const multi = TS.planThermalRequests({
    mode: "MULTI_SOURCE",
    sentinel3a: true,
    sentinel3b: true,
  });
  assert.deepEqual(multi.slstrIds, ["sentinel3a-slstr", "sentinel3b-slstr"]);
  assert.equal(multi.mtg, true);
  const firmsOnly = TS.planThermalRequests({
    mode: "FIRMS_ONLY",
    sentinel3a: true,
    sentinel3b: true,
  });
  assert.equal(firmsOnly.mtg, false, "MTG is never requested in FIRMS_ONLY");
});

test("thermal: per-source flags restrict SLSTR WFS queries and disabled sensors never query", async () => {
  const TS = A.ThermalSources;
  const req = {
    bbox,
    countryCode: "TR",
    startTime: new Date("2026-08-01T00:00:00Z"),
    endTime: new Date("2026-08-02T00:00:00Z"),
  };
  const calls = [];
  const handler = async (opts) => {
    calls.push(opts.typeNames);
    return { features: [], pages: 1, totalMatched: 0, meta: {} };
  };
  await withGetFeature(() => TS.loadSlstrGroup(req, ["sentinel3b-slstr"]), handler);
  assert.deepEqual(calls, ["copernicus:sentinel3b_slstr_level2_frp"], "only the enabled sensor is queried");
  calls.length = 0;
  await withGetFeature(() => TS.loadSlstrGroup(req, ["sentinel3a-slstr"]), handler);
  assert.deepEqual(calls, ["copernicus:sentinel3a_slstr_level2_frp"]);
  const planB = TS.planThermalRequests({ mode: "SEPARATE_SOURCES", sentinel3a: true, sentinel3b: false });
  assert.deepEqual(planB.slstrIds, ["sentinel3a-slstr"]);
  calls.length = 0;
  await withGetFeature(() => TS.loadSlstrGroup(req, []), handler);
  assert.deepEqual(calls, [], "no enabled sensor means no WFS request");
});

test("thermal: time change feeds a new UTC window and identical windows are never re-requested", async () => {
  const TS = A.ThermalSources;
  const seen = [];
  await withGetFeature(
    () =>
      TS.loadSlstrGroup(
        {
          bbox,
          countryCode: "TR",
          startTime: new Date("2026-08-01T00:00:00Z"),
          endTime: new Date("2026-08-01T12:00:00Z"),
        },
        ["sentinel3a-slstr"],
      ),
    async (opts) => {
      seen.push({ from: opts.from, to: opts.to });
      return { features: [], pages: 1, totalMatched: 0, meta: {} };
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].from.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(seen[0].to.toISOString(), "2026-08-01T12:00:00.000Z");
  const k1 = TS.thermalWindowKey("TR", new Date("2026-08-02T10:00:00Z"));
  assert.equal(k1, TS.thermalWindowKey("TR", new Date("2026-08-02T10:00:00Z")));
  assert.notEqual(k1, TS.thermalWindowKey("ES", new Date("2026-08-02T10:00:00Z")), "country changes the window");
  assert.notEqual(k1, TS.thermalWindowKey("TR", new Date("2026-08-03T10:00:00Z")), "time changes the window");
});

test("thermal: late FIRMS completion recomputes an association previously labeled without FIRMS", () => {
  const TS = A.ThermalSources;
  const fire = (lat = 38.6, lon = 35.2) =>
    normDet({ frpMw: 45, lat, lon });
  const slstr = normDet({
    sourceId: "sentinel3a-slstr",
    sourceName: "Sentinel-3A SLSTR",
    sensorFamily: "slstr",
    satellite: "S3A",
    frpMw: 61.2,
    detectedAt: "2026-08-02T10:30:00Z",
  });
  const pre = TS.associationSources({ fireData: [], slstrData: [slstr], mtgFrpData: [] });
  const preEvents = Association.associateAcrossSources({ bySource: pre });
  assert.equal(preEvents.length, 1);
  assert.equal(preEvents[0].supportingSources.includes("nasa-firms"), false, "no FIRMS key, no FIRMS label");
  assert.equal(preEvents[0].confirmationLevel, 1);
  const post = TS.associationSources({ fireData: [fire()], slstrData: [slstr], mtgFrpData: [] });
  const postEvents = Association.associateAcrossSources({ bySource: post });
  const merged = postEvents.find((e) => e.observationCount === 2);
  assert.ok(merged, "late FIRMS data merges on recompute");
  assert.deepEqual(merged.supportingSources.sort(), ["nasa-firms", "sentinel3a-slstr"]);
  assert.equal(merged.independentSensorCount, 2);
  assert.equal(merged.confirmationLevel, 2);
});

test("thermal: orchestrator status keys never label warn/empty/error as success", () => {
  const TS = A.ThermalSources;
  assert.equal(TS.orchestratorStatusKey("ok"), "thermal.orchestrator.slstrOk");
  assert.equal(TS.orchestratorStatusKey("warn"), "thermal.orchestrator.warn");
  assert.equal(TS.orchestratorStatusKey("empty"), "thermal.orchestrator.empty");
  assert.equal(TS.orchestratorStatusKey("error"), "thermal.orchestrator.error");
  assert.equal(TS.orchestratorStatusKey("loading"), null);
  const okTxt = I.t("thermal.orchestrator.slstrOk", { a: 1, b: 2 });
  const warnTxt = I.t("thermal.orchestrator.warn");
  const emptyTxt = I.t("thermal.orchestrator.empty");
  const errorTxt = I.t("thermal.orchestrator.error");
  assert.ok(okTxt);
  assert.ok(warnTxt);
  assert.ok(emptyTxt);
  assert.ok(errorTxt);
  assert.notEqual(warnTxt, okTxt);
  assert.notEqual(emptyTxt, okTxt);
  assert.notEqual(errorTxt, okTxt);
  assert.ok(source.app.includes("orchestratorStatusKey"), "app drives status text through the mapping");
});

test("thermal: country change clears alternate layers, data, statuses and the thermal sequence", () => {
  const appSrc = source.app,
    mapSrc = source.map;
  const resetBlock = appSrc.slice(
    appSrc.indexOf("resetCountryState("),
    appSrc.indexOf("resetCountryState(") + 900,
  );
  for (const token of [
    "slstrData",
    "slstrStatus",
    "mtgFrpData",
    "multiSensorEvents",
    "_thermalWindowKey",
    "sentinel3a-slstr",
    "sentinel3b-slstr",
    "mtg-fci-frp",
  ])
    assert.ok(resetBlock.includes(token), `resetCountryState clears ${token}`);
  const mapBlock = mapSrc.slice(mapSrc.indexOf("resetCountry()"));
  for (const token of [
    "slstrLayer.clearLayers",
    "slstrALayer.clearLayers",
    "slstrBLayer.clearLayers",
    "mtgFrpLayer.clearLayers",
    "multiSensorLayer.clearLayers",
  ])
    assert.ok(mapBlock.includes(token), `map.resetCountry clears ${token}`);
});

test("thermal: country reset bumps each source's own seq, not a shared base", () => {
  const TS = A.ThermalSources;
  const start = source.app.indexOf("resetCountryState(");
  const m = source.app
    .slice(start, start + 1500)
    .match(/(\n[ \t]*)if \(A\.ThermalSources\) \{[\s\S]*?\1\}/);
  assert.ok(m && m[0], "seq-reset block found inside resetCountryState");
  assert.ok(m[0].includes("nextSeq"), "reset uses per-source nextSeq");
  const resetBlock = new Function("A", m[0]);
  TS.patchState("sentinel3a-slstr", { seq: 2 });
  TS.patchState("sentinel3b-slstr", { seq: 7 });
  TS.patchState("mtg-fci-frp", { seq: 11 });
  TS.patchState("multi-sensor", { seq: 3 });
  resetBlock(A);
  assert.equal(TS.state("sentinel3a-slstr").seq, 3, "S3A 2 -> 3");
  assert.equal(TS.state("sentinel3b-slstr").seq, 8, "S3B 7 -> 8");
  assert.equal(TS.state("mtg-fci-frp").seq, 12, "MTG 11 -> 12");
  assert.equal(TS.state("multi-sensor").seq, 4, "multi-sensor 3 -> 4");
  for (const id of ["sentinel3a-slstr", "sentinel3b-slstr", "mtg-fci-frp", "multi-sensor"]) {
    assert.equal(TS.state(id).status, "idle", `${id} reset to idle`);
    assert.equal(TS.state(id).count, 0, `${id} count cleared`);
    assert.deepEqual(TS.state(id).metrics, TS.defaultMetrics(), `${id} metrics reset to unknown`);
  }
});

test("multi-sensor layer only shows events confirmed by at least two independent families", () => {
  const eligible = A.MapManager.eligibleMultiSensor;
  const single = { id: "e1", lat: 38.6, lon: 35.2, independentSensorCount: 1, observationCount: 1 };
  const dual = { id: "e2", lat: 38.7, lon: 35.3, independentSensorCount: 2, observationCount: 3 };
  const triple = { id: "e3", lat: 39.1, lon: 40.0, independentSensorCount: 3, observationCount: 5 };
  const out = eligible([single, dual, triple]);
  assert.deepEqual(out.map((e) => e.id).sort(), ["e2", "e3"]);
  assert.equal(eligible([]).length, 0);
  assert.equal(eligible([single]).length, 0, "single-source events stay on their raw layers");
});

test("association: multi-sensor FRP is a per-source maximum, never a sum or an average", () => {
  const events = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [normDet({ frpMw: 45 })],
      "sentinel3a-slstr": [
        normDet({
          sourceId: "sentinel3a-slstr",
          sourceName: "Sentinel-3A SLSTR",
          sensorFamily: "slstr",
          satellite: "S3A",
          frpMw: 61.2,
        }),
      ],
    },
  });
  const merged = events.find((e) => e.observationCount === 2);
  assert.ok(merged);
  assert.equal(merged.maxFrpMw, 61.2, "61.2 is max, not 106.2 sum or 53.1 average");
  assert.equal(merged.maxFrpBySource["nasa-firms"], 45);
  assert.equal(merged.maxFrpBySource["sentinel3a-slstr"], 61.2);
});

test("association: 10k synthetic observations associate quickly, deterministically and never over-merge", async () => {
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const make = (seed) => {
    const rnd = mulberry32(seed);
    const firms = [];
    const slstr = [];
    for (let i = 0; i < 5000; i++) {
      firms.push(
        normDet({
          frpMw: 20 + rnd() * 200,
          lat: 36.5 + rnd() * 5,
          lon: 29 + rnd() * 10,
          detectedAt: `2026-08-02T10:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`,
        }),
      );
      slstr.push(
        normDet({
          sourceId: "sentinel3a-slstr",
          sourceName: "Sentinel-3A SLSTR",
          sensorFamily: "slstr",
          satellite: "S3A",
          frpMw: 20 + rnd() * 200,
          lat: 36.5 + rnd() * 5,
          lon: 29 + rnd() * 8,
          detectedAt: `2026-08-02T10:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`,
        }),
      );
    }
    return {
      "nasa-firms": firms,
      "sentinel3a-slstr": slstr,
    };
  };
  const bySource = make(1);
  const t0 = Date.now();
  const events = Association.associateAcrossSources({ bySource });
  const elapsed = Date.now() - t0;
  assert.ok(events.length > 0, "associator returns events");
  for (const ev of events) {
    assert.ok(
      ev.independentSensorCount === (ev.sensorFamilies || []).length &&
        ev.independentSensorCount <= 2,
      "families counted exactly, never invented",
    );
    assert.ok(ev.observationCount >= 1);
  }
  assert.ok(elapsed < 4000, `10k observations associated in ${elapsed} ms`);
  const again = Association.associateAcrossSources({ bySource: make(1) });
  assert.deepEqual(
    again.map((e) => e.id),
    events.map((e) => e.id),
    "indexed association is deterministic for identical input",
  );
});

const wfsPage1 = JSON.parse(read("tests/fixtures/wfs-page1.json"));
const wfsPage2 = JSON.parse(read("tests/fixtures/wfs-page2.json"));
const wfsEmpty = JSON.parse(read("tests/fixtures/wfs-empty.json"));
const wfsInvalid = JSON.parse(read("tests/fixtures/wfs-invalid.json"));

const WFS = A.EumetviewWfs;
const bbox = [25.6, 35.75, 44.9, 42.2];
const from = "2026-08-01T00:00:00Z";
const to = "2026-08-02T00:00:00Z";

async function withFetch(fn, handler) {
  const orig = global.fetch;
  try {
    global.fetch = handler;
    const result = await fn();
    return result;
  } finally {
    if (orig) global.fetch = orig;
    else delete global.fetch;
  }
}

test("EUMETView WFS: CQL builder uses cql_filter with time field and never time=", () => {
  const cql = WFS.buildCql({ bbox, from, to });
  assert.equal(cql, "BBOX(geom, 35.75, 25.6, 42.2, 44.9) AND time >= '2026-08-01T00:00:00Z' AND time <= '2026-08-02T00:00:00Z'");
  const url = WFS.buildUrl({ typeNames: "copernicus:sentinel3a_slstr_level2_frp", bbox, from, to, count: 2000 });
  assert.ok(url.includes("service=WFS"));
  assert.ok(url.includes("request=GetFeature"));
  assert.equal(url.includes("cql_filter"), true);
  assert.equal(new URL(url).searchParams.get("cql_filter"), cql);
  assert.equal(url.includes("time="), false, "the WFS time= parameter is never used");
  assert.ok(url.includes("count=2000"));
  assert.equal(url.includes("startIndex="), false, "startIndex 0 omitted");
  assert.equal(new URL(url).searchParams.get("outputFormat"), "application/json");
});

test("EUMETView WFS: pagination continues after 2000 and stops on short page", async () => {
  const seen = [];
  let calls = 0;
  const res = await withFetch(
    async () =>
      WFS.getFeature({
        typeNames: "copernicus:sentinel3a_slstr_level2_frp",
        bbox,
        from,
        to,
        count: 2,
        ttl: 0,
        onPage: (p) => seen.push(p.page),
      }),
    async () => {
      calls++;
      const shortPage = {
        ...wfsPage2,
        features: wfsPage2.features.slice(0, 1),
        numberReturned: 1,
      };
      return {
        ok: true,
        status: 200,
        async json() {
          return calls === 1 ? wfsPage1 : shortPage;
        },
        async text() {
          return "";
        },
      };
    },
  );
  assert.equal(calls, 2, "two pages requested while page size kept at 2");
  assert.deepEqual(seen, [1, 2]);
  assert.equal(res.pages, 2);
  assert.equal(res.totalMatched, 3);
  assert.equal(res.features.length, 3, "page-boundary duplicate removed");
  assert.equal(res.url.includes("startIndex="), false);
});

test("EUMETView WFS: empty response is a valid empty dataset", async () => {
  const res = await withFetch(
    () =>
      WFS.getFeature({
        typeNames: "copernicus:sentinel3a_slstr_level2_frp",
        bbox,
        from,
        to,
        count: 2,
        ttl: 0,
      }),
    async () => ({
      json: async () => wfsEmpty,
      text: async () => "{}",
      status: 200,
      ok: true,
    }),
  );
  assert.equal(res.features.length, 0);
  assert.equal(res.pages, 1);
  assert.equal(WFS.isGeoJsonCollection(wfsInvalid), false);
});

test("EUMETView WFS: invalid GeoJSON rejected with INVALID_RESPONSE", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () =>
          WFS.getFeature({
            typeNames: "x",
            bbox,
            from,
            to,
            count: 2,
            ttl: 0,
          }),
        async () => ({
          json: async () => wfsInvalid,
          status: 200,
          ok: true,
        }),
      ),
    /not a GeoJSON FeatureCollection/,
  );
});

test("EUMETView WFS: max page guard applies and partial results are reported", async () => {
  await assert.rejects(
    () =>
      withFetch(
        async () =>
          WFS.getFeature({
            typeNames: "copernicus:sentinel3a_slstr_level2_frp",
            bbox,
            from,
            to,
            count: 2,
            maxPages: 3,
            ttl: 0,
          }),
        async () => ({
          json: async () => wfsPage1,
          status: 200,
          ok: true,
        }),
      ),
    /max page limit reached/,
  );
});

test("EUMETView WFS: HTTP error surfaces as HTTP_ERROR with status", async () => {
  await assert.rejects(
    () =>
      withFetch(
        () =>
          WFS.getFeature({
            typeNames: "x",
            bbox,
            from,
            to,
            count: 2,
            ttl: 0,
          }),
        async () => ({
          json: async () => ({}),
          text: async () => "boom",
          status: 500,
          ok: false,
        }),
      ),
    (e) => e.kind === "HTTP_ERROR" && e.status === 500,
  );
});

test("EUMETView WFS: aborted signal prevents result application", async () => {
  const ctrl = new AbortController();
  let aborted = false;
  const p = withFetch(
    () =>
      WFS.getFeature({
        typeNames: "x",
        bbox,
        from,
        to,
        count: 2,
        ttl: 0,
        signal: ctrl.signal,
      }),
    (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          aborted = true;
          const e = new Error("The operation was aborted.");
          e.name = "AbortError";
          reject(e);
        });
      }),
  );
  setTimeout(() => ctrl.abort(), 5);
  await assert.rejects(p, (e) => e.kind === "ABORTED");
  assert.ok(aborted, "underlying fetch was aborted");
});

const Association = A.ThermalAssociation;

function normDet(overrides) {
  return {
    detectionId: null,
    sourceId: "nasa-firms",
    sourceName: "NASA FIRMS",
    sensorFamily: "viirs-modis",
    satellite: "NOAA-21",
    detectedAt: "2026-08-02T10:00:00Z",
    lat: 38.6,
    lon: 35.2,
    frpMw: 45,
    frpUncertaintyMw: null,
    countryCode: "TR",
    ...overrides,
  };
}

test("association: deduplicateWithinSource merges identical records keeping the max FRP", () => {
  const out = Association.deduplicateWithinSource([
    normDet({ frpMw: 45 }),
    normDet({ frpMw: 55 }),
    normDet({ frpMw: 30, lat: 39.5, lon: 36.1 }),
  ]);
  assert.equal(out.length, 2);
  const dup = out.find((d) => d.lat === 38.6);
  assert.equal(dup.frpMw, 55, "max FRP kept, never summed");
});

test("association: FIRMS-only dataset yields one event per detection, no cross-source merge", () => {
  const events = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [
        normDet({ frpMw: 45 }),
        normDet({ frpMw: 30, lat: 39.5, lon: 36.1 }),
      ],
    },
  });
  assert.equal(events.length, 2);
  for (const ev of events) {
    assert.equal(ev.observationCount, 1);
    assert.equal(ev.independentSensorCount, 1);
    assert.equal(ev.confirmationLevel, 1);
    assert.deepEqual(ev.sensorFamilies, ["viirs-modis"]);
    assert.deepEqual(ev.supportingSources, ["nasa-firms"]);
    assert.equal(ev.maxFrpMw, ev.observations[0].frpMw);
    assert.deepEqual(ev.maxFrpBySource, {
      "nasa-firms": ev.observations[0].frpMw,
    });
  }
});

test("association: same event seen by VIIRS and SLSTR merges into one multi-sensor event", () => {
  const events = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [
        normDet({ frpMw: 45, detectedAt: "2026-08-02T10:00:00Z" }),
        normDet({ frpMw: 12, lat: 41.2, lon: 42.8, detectedAt: "2026-08-02T10:00:00Z" }),
      ],
      "sentinel3a-slstr": [
        normDet({
          sourceId: "sentinel3a-slstr",
          sourceName: "Sentinel-3A SLSTR",
          sensorFamily: "slstr",
          satellite: "S3A",
          frpMw: 61.2,
          detectedAt: "2026-08-02T10:30:00Z",
        }),
      ],
    },
  });
  assert.equal(events.length, 2, "co-located merged, distant one separate");
  const merged = events.find((e) => e.observationCount === 2);
  assert.ok(merged, "merged event exists");
  assert.deepEqual(merged.supportingSources.sort(), ["nasa-firms", "sentinel3a-slstr"]);
  assert.deepEqual(merged.sensorFamilies.sort(), ["slstr", "viirs-modis"]);
  assert.equal(merged.independentSensorCount, 2);
  assert.equal(merged.confirmationLevel, 2);
  assert.equal(merged.maxFrpMw, 61.2, "max of finite FRPs, never summed (45+61.2)");
  assert.deepEqual(merged.maxFrpBySource, {
    "nasa-firms": 45,
    "sentinel3a-slstr": 61.2,
  });
  assert.deepEqual(merged.supportingPlatforms.sort(), ["NOAA-21", "S3A"]);
  const single = events.find((e) => e.observationCount === 1);
  assert.equal(single.confirmationLevel, 1);
});

test("association: time window limits cross-source merge (90 min VIIRS-SLSTR)", () => {
  const far = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [normDet({ frpMw: 45, detectedAt: "2026-08-02T10:00:00Z" })],
      "sentinel3b-slstr": [
        normDet({
          sourceId: "sentinel3b-slstr",
          sensorFamily: "slstr",
          satellite: "S3B",
          frpMw: 33.3,
          detectedAt: "2026-08-02T12:00:00Z",
        }),
      ],
    },
  });
  assert.equal(far.length, 2, "120 min apart exceeds the 90 min window");
  assert.ok(far.every((e) => e.observationCount === 1));
});

test("association: VIrRS-MTG and SLSTR-MTG rules use their own thresholds", () => {
  const rules = Association.pairRules();
  assert.deepEqual(rules.viirsToSlstr, { maxDistanceKm: 2.5, maxTimeMinutes: 90 });
  assert.deepEqual(rules.viirsToMtg, { maxDistanceKm: 4, maxTimeMinutes: 30 });
  assert.deepEqual(rules.slstrToMtg, { maxDistanceKm: 4, maxTimeMinutes: 45 });
  const events = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [normDet({ frpMw: 45, detectedAt: "2026-08-02T10:00:00Z" })],
      "sentinel3a-slstr": [
        normDet({
          sourceId: "sentinel3a-slstr",
          sensorFamily: "slstr",
          satellite: "S3A",
          frpMw: 61.2,
          detectedAt: "2026-08-02T10:00:00Z",
        }),
      ],
      "mtg-fci-frp": [
        normDet({
          sourceId: "mtg-fci-frp",
          sensorFamily: "mtg",
          satellite: "MTG-I1",
          frpMw: 150,
          detectedAt: "2026-08-02T10:20:00Z",
        }),
      ],
    },
  });
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.observationCount, 3);
  assert.equal(ev.independentSensorCount, 3);
  assert.equal(ev.confirmationLevel, 3);
  assert.equal(ev.maxFrpMw, 150, "max, never summed");
  assert.deepEqual(ev.maxFrpBySource, {
    "nasa-firms": 45,
    "sentinel3a-slstr": 61.2,
    "mtg-fci-frp": 150,
  });
});

test("association: distance beyond threshold keeps events separate", () => {
  const events = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [normDet({ frpMw: 45, lat: 38.6, lon: 35.2 })],
      "sentinel3a-slstr": [
        normDet({
          sourceId: "sentinel3a-slstr",
          sensorFamily: "slstr",
          satellite: "S3A",
          frpMw: 61.2,
          lat: 38.62,
          lon: 35.3,
        }),
      ],
    },
  });
  assert.equal(events.length, 2, "~8 km apart exceeds 2.5 km window");
});

test("association: empty or absent sources produce no events", () => {
  assert.deepEqual(Association.associateAcrossSources({ bySource: {} }), []);
  assert.deepEqual(
    Association.associateAcrossSources({ bySource: { "nasa-firms": [] } }),
    [],
  );
});

test("association: east-west pair within threshold merges under a latitude-aware spatial grid", () => {
  const lat = 40;
  const CELL_DEG = 4 / 111.32;
  const lonA = (800 + 0.86) * CELL_DEG;
  const dLon = 3.5 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const lonB = lonA + dLon;
  assert.equal(
    Math.floor(lonB / CELL_DEG) - Math.floor(lonA / CELL_DEG) >= 2,
    true,
    "coordinates land in cells two apart under the legacy uniform-degree grid",
  );
  const dist = A.Utils.haversineKm({ lat, lon: lonA }, { lat, lon: lonB });
  assert.ok(dist > 3.2 && dist < 3.8, `east-west offset is ${dist.toFixed(2)} km`);
  const src = (lon, sourceId, sensorFamily, satellite, frpMw) => ({
    detectionId: `pair-${lon}-${sourceId}`,
    sourceId,
    sourceName: sourceId,
    sensorFamily,
    satellite,
    detectedAt: "2026-08-02T10:00:00Z",
    lat,
    lon,
    frpMw,
    countryCode: "TR",
  });
  const tight = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [src(lonA, "nasa-firms", "viirs-modis", "NOAA-21", 50)],
      "mtg-fci-frp": [
        src(lonB, "mtg-fci-frp", "mtg", "MTG-I1", 70),
      ],
    },
  });
  assert.equal(tight.length, 1, "3.5 km east-west pair at 40N is one association event");
  assert.equal(tight[0].observationCount, 2);
  const apart = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [src(lonA, "nasa-firms", "viirs-modis", "NOAA-21", 50)],
      "mtg-fci-frp": [
        src(lonA + dLon * 1.6, "mtg-fci-frp", "mtg", "MTG-I1", 70),
      ],
    },
  });
  assert.equal(apart.length, 2, ">4 km east-west pair stays separate");
});

test("association: over-merged transitive chains split without losing observations", () => {
  const lat = 40;
  const kmToDeg = (k) => k / (111.32 * Math.cos((lat * Math.PI) / 180));
  const obs = (id, sourceId, sensorFamily, satellite, lonOffset) => ({
    detectionId: id,
    sourceId,
    sourceName: sourceId,
    sensorFamily,
    satellite,
    lat,
    lon: kmToDeg(lonOffset),
    detectedAt: "2026-08-02T10:00:00Z",
    frpMw: 50,
    countryCode: "TR",
  });
  const a = obs("f1", "nasa-firms", "viirs-modis", "NOAA-21", 0);
  const b = obs("s1", "sentinel3a-slstr", "slstr", "S3A", 2);
  const c = obs("m1", "mtg-fci-frp", "mtg", "MTG-I1", 4.2);
  const run = () =>
    Association.associateAcrossSources({
      bySource: {
        "nasa-firms": [a],
        "sentinel3a-slstr": [b],
        "mtg-fci-frp": [c],
      },
    });
  const events = run();
  const allObs = events.flatMap((e) => e.observations);
  assert.equal(events.length, 2, "valid pair wins the greedy merge, chain stays split");
  assert.equal(allObs.length, 3, "no observation is dropped by an over-merged chain");
  assert.equal(
    new Set(allObs.map((o) => o.detectionId)).size,
    3,
    "no detectionId is lost or used twice",
  );
  const again = run();
  assert.deepEqual(
    again.map((e) => e.id),
    events.map((e) => e.id),
    "identical input reproduces the same event ids",
  );
  assert.deepEqual(
    again.map((e) => e.observations.map((o) => o.detectionId)),
    events.map((e) => e.observations.map((o) => o.detectionId)),
    "identical input reproduces the same clusters in the same order",
  );
});

test("association: three sources mutually within their thresholds form one event", () => {
  const lat = 40;
  const kmToDeg = (k) => k / (111.32 * Math.cos((lat * Math.PI) / 180));
  const obs = (id, sourceId, sensorFamily, satellite, lon) => ({
    detectionId: id,
    sourceId,
    sourceName: sourceId,
    sensorFamily,
    satellite,
    detectedAt: "2026-08-02T10:00:00Z",
    lat,
    lon: kmToDeg(lon),
    frpMw: 50,
    countryCode: "TR",
  });
  const events = Association.associateAcrossSources({
    bySource: {
      "nasa-firms": [obs("fA", "nasa-firms", "viirs-modis", "NOAA-21", 0)],
      "sentinel3a-slstr": [obs("sB", "sentinel3a-slstr", "slstr", "S3A", 2)],
      "mtg-fci-frp": [obs("mC", "mtg-fci-frp", "mtg", "MTG-I1", 3.6)],
    },
  });
  assert.equal(events.length, 1, "all three sources pairwise in range share one event");
  assert.equal(events[0].observationCount, 3);
  assert.equal(events[0].independentSensorCount, 3);
});

function evidenceGrid(lineFeatures) {
  const gr = new A.GridRepository();
  gr.setCountry("TR");
  gr.index("154", { type: "FeatureCollection", features: lineFeatures });
  return gr;
}
function evidenceDet(id, lat, lon, over) {
  return {
    lat,
    lon,
    detectedAt: over?.detectedAt || "2026-08-05T10:00:00Z",
    frp: over?.frp !== undefined ? over.frp : 30,
    confidence: over?.confidence !== undefined ? over.confidence : "high",
    satellite: over?.satellite || "NOAA-21",
    instrument: "VIIRS",
    product: "VIIRS_NOAA21_NRT",
    dayNight: "D",
    sourceName: "FIRMS",
    id,
  };
}
function evidenceEvents(dets) {
  return U.clusterFires(
    dets.map((d) =>
      U.normalizeFireDetection(d, { countryCode: "TR", source: "NASA FIRMS" }),
    ),
  );
}
const EVIDENCE_LINE = {
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [28.65, 36.9],
      [28.65, 37.0],
    ],
  },
  properties: {
    countryCode: "TR",
    gridClass: "154",
    actualVoltageKv: 154,
    name: "VERT-154",
  },
};
const EVIDENCE_REF = new Date("2026-08-05T12:00:00Z");

test("evidence: nearest point on a segment is exact, clamped and finite", () => {
  const a = { lat: 36.9, lon: 28.6 },
    b = { lat: 37.0, lon: 28.7 };
  const p = { lat: 36.95, lon: 28.65 },
    res = U.pointSegmentNearestKm(p, a, b);
  assert.ok(
    Math.abs(res.distanceKm - U.pointSegmentKm(p, a, b)) < 1e-9,
    "distance matches pointSegmentKm exactly",
  );
  assert.ok(Number.isFinite(res.lat) && Number.isFinite(res.lon));
  const beyond = U.pointSegmentNearestKm({ lat: 37.5, lon: 29.0 }, a, b);
  assert.ok(
    Math.abs(beyond.lat - b.lat) < 1e-6 && Math.abs(beyond.lon - b.lon) < 1e-6,
    "clamps to the far endpoint",
  );
  const on = U.pointSegmentNearestKm(
    { lat: 36.95, lon: 28.65 },
    { lat: 36.95, lon: 28.6 },
    { lat: 36.95, lon: 28.7 },
  );
  assert.ok(on.distanceKm < 1e-9, "point on the segment is distance zero");
  assert.ok(Math.abs(on.lon - 28.65) < 1e-9);
});

test("evidence: nearest point comes from the geometry, not the segment midpoint", () => {
  const gr = evidenceGrid([
    {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [28.6, 36.9],
            [28.62, 36.91],
          ],
          [
            [28.7, 36.95],
            [28.8, 37.0],
          ],
        ],
      },
      properties: {
        countryCode: "TR",
        gridClass: "154",
        actualVoltageKv: 154,
        name: "MULTI-1",
      },
    },
  ]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("m1", 36.965, 28.715, { frp: 40, confidence: "nominal" }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out.length, 1);
  const ev = out[0].evidence;
  assert.ok(ev, "evidence generated for the nearest segment");
  assert.ok(
    ev.nearestLineLongitude > 28.7 && ev.nearestLineLongitude < 28.8,
    "nearest point lies on the second polyline, not the first",
  );
  const mid = U.segmentMidpoint(out[0].nearestLine.feature);
  assert.ok(
    Math.abs(ev.nearestLineLatitude - mid.lat) > 1e-4 ||
      Math.abs(ev.nearestLineLongitude - mid.lon) > 1e-4,
    "nearest point differs from the raw segment midpoint",
  );
});

test("evidence: trigger is the raw detection nearest to the line, not the highest FRP", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("near", 36.951, 28.64, { frp: 5, confidence: "low" }),
      evidenceDet("far", 36.97, 28.62, { frp: 180, confidence: "high" }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  const ev = out[0].evidence;
  assert.ok(ev);
  assert.equal(ev.triggerDetectionId, "near");
  assert.equal(ev.selectionRule, "nearest_raw_detection");
  assert.ok(ev.triggerDistanceKm < 1);
});

test("evidence: distance dominates inside a cluster — far high-FRP high-confidence never beats a nearer one", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("nearLow", 36.95, 28.64, {
        frp: 2,
        confidence: "low",
        detectedAt: "2026-08-05T09:00:00Z",
      }),
      evidenceDet("farHigh", 36.948, 28.59, {
        frp: 500,
        confidence: "high",
        detectedAt: "2026-08-05T11:59:00Z",
      }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out.length, 1, "both detections form one cluster");
  const ev = out[0].evidence;
  assert.equal(ev.triggerDetectionId, "nearLow");
  assert.ok(ev.triggerDistanceKm < 1);
  assert.equal(ev.selectionRule, "nearest_raw_detection");
});

test("evidence: per-line evidence is isolated across separate events", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("near", 36.95, 28.64, { frp: 5, confidence: "low" }),
      evidenceDet("far", 36.7318, 28.9989, { frp: 500, confidence: "high" }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.ok(out.length >= 2, "two separate events");
  const lineRows = out.filter((a) => a.evidence?.lineId);
  assert.equal(lineRows.length, 1, "only the near event references the line");
  assert.equal(lineRows[0].evidence.triggerDetectionId, "near");
  assert.equal(lineRows[0].evidence.triggerFrpMw, 5);
});

test("evidence: equal distance falls back to higher confidence", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("lowconf", 36.95, 28.64, { confidence: "low", frp: 10 }),
      evidenceDet("highconf", 36.95, 28.66, { confidence: "high", frp: 10 }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out[0].evidence.triggerDetectionId, "highconf");
});

test("evidence: equal distance and confidence falls back to higher FRP", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("lowfrp", 36.95, 28.64, { confidence: "high", frp: 10 }),
      evidenceDet("highfrp", 36.95, 28.66, { confidence: "high", frp: 80 }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out[0].evidence.triggerDetectionId, "highfrp");
});

test("evidence: equal distance, confidence and FRP falls back to the newer detection", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("old", 36.95, 28.64, { frp: 40, detectedAt: "2026-08-05T10:00:00Z" }),
      evidenceDet("new", 36.95, 28.66, { frp: 40, detectedAt: "2026-08-05T11:00:00Z" }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out[0].evidence.triggerDetectionId, "new");
});

test("evidence: full tie breaks on the stable detection id ordering", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("zid", 36.95, 28.64, {
        frp: 40,
        confidence: "high",
        detectedAt: "2026-08-05T10:00:00Z",
      }),
      evidenceDet("aid", 36.95, 28.66, {
        frp: 40,
        confidence: "high",
        detectedAt: "2026-08-05T10:00:00Z",
      }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out[0].evidence.triggerDetectionId, "aid");
});

test("evidence: missing detection id falls back to a stable composite id", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const det = evidenceDet(null, 36.95, 28.64, { frp: 10 });
  const out = gr.analyzeEvents(evidenceEvents([det]), 25, EVIDENCE_REF, []);
  const ev = out[0].evidence;
  assert.ok(ev);
  assert.equal(ev.triggerDetectionId, null);
  const out2 = gr.analyzeEvents(
    evidenceEvents([det, evidenceDet("other", 36.95, 28.66, { frp: 10 })]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(
    out2[0].evidence.triggerDetectionId,
    null,
    "composite id sorts deterministically without an explicit id",
  );
  assert.equal(out2[0].evidence.triggerSatellite, "NOAA-21");
});

test("evidence: null FRP and missing confidence never break selection", () => {
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([
      evidenceDet("nulls", 36.95, 28.64, { frp: null, confidence: null }),
      evidenceDet("with", 36.95, 28.66, { frp: 12, confidence: "high" }),
    ]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out[0].evidence.triggerDetectionId, "with");
  assert.equal(out[0].evidence.triggerFrpMw, 12);
});

test("evidence: broken or empty line geometry yields no line, no crash", () => {
  const gr = evidenceGrid([
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: { countryCode: "TR", gridClass: "154", actualVoltageKv: 154, name: "EMPTY-1" },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [[[28.65, 36.9], [NaN, 37.0]]],
      },
      properties: { countryCode: "TR", gridClass: "154", actualVoltageKv: 154, name: "BROKEN-1" },
    },
  ]);
  const out = gr.analyzeEvents(
    evidenceEvents([evidenceDet("b1", 36.95, 28.65, { frp: 10 })]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].evidence, null);
});

test("risk: Mugla fixture keeps the risk formula unchanged and evidence is additive", () => {
  const gr = evidenceGrid([
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [28.6, 36.9],
          [28.72, 36.96],
        ],
      },
      properties: {
        countryCode: "TR",
        gridClass: "154",
        actualVoltageKv: 154,
        name: "KÖYCEĞİZ-154",
      },
    },
  ]);
  const events = evidenceEvents([
    evidenceDet("A", 36.95, 28.65, { frp: 60, confidence: "high", detectedAt: "2026-08-05T10:00:00Z" }),
    evidenceDet("B", 36.98, 28.69, { frp: 50, confidence: "nominal", satellite: "NOAA-20", product: "VIIRS_NOAA20_NRT", detectedAt: "2026-08-05T10:10:00Z" }),
    evidenceDet("C", 37.0, 28.73, { frp: 45, confidence: "nominal", satellite: "SNPP", product: "VIIRS_SNPP_NRT", detectedAt: "2026-08-05T10:20:00Z" }),
    evidenceDet("D", 37.02, 28.77, { frp: 55, confidence: "high", detectedAt: "2026-08-05T10:30:00Z" }),
  ]);
  const out = gr.analyzeEvents(events, 25, EVIDENCE_REF, []);
  assert.equal(out.length, 1, "all four detections form one event");
  const a = out[0],
    ev = a.evidence;
  assert.ok(ev, "evidence present");
  const d = a.minDistanceKm,
    distanceScore = d <= 0.5 ? 60 : d <= 1 ? 52 : d <= 2 ? 44 : d <= 3 ? 36 : d <= 5 ? 24 : 0,
    frpScore = Math.min(18, Math.sqrt(Math.max(0, a.event.maxFrp)) * 2),
    ageScore = a.ageHours <= 3 ? 15 : a.ageHours <= 6 ? 12 : a.ageHours <= 12 ? 8 : a.ageHours <= 24 ? 4 : 1,
    expected = U.clamp(Math.round(distanceScore + frpScore + ageScore + 7 + 0), 0, 100);
  assert.equal(a.riskScore, expected, "score formula unchanged with evidence attached");
  assert.equal(ev.riskScore, a.riskScore);
  assert.equal(ev.riskLevel, a.riskBand.level);
  assert.equal(ev.lineId, a.nearestLine.feature.assetKey);
  assert.equal(ev.eventId, a.event.id);
  assert.equal(ev.evidenceCount, 4);
  assert.equal(ev.selectionRule, "nearest_raw_detection");
  assert.equal(ev.triggerDetectionId, "A", "near member triggers the line risk");
  assert.ok(ev.triggerDistanceKm < 5, "trigger is close to the line");
  const centerDist = U.haversineKm(
    { lat: ev.eventCenterLatitude, lon: ev.eventCenterLongitude },
    { lat: ev.triggerLatitude, lon: ev.triggerLongitude },
  );
  assert.ok(centerDist > 2, "cluster center is far from the trigger pixel");
  const same = gr.analyzeEvents(events, 25, EVIDENCE_REF, []);
  assert.deepEqual(same[0].evidence, ev, "evidence selection is deterministic");
});

test("risk: substation-only events carry no line evidence", () => {
  const gr = evidenceGrid([]);
  gr.index("substations", {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [28.65, 36.95] },
        properties: { countryCode: "TR", name: "TM-1" },
      },
    ],
  });
  const out = gr.analyzeEvents(
    evidenceEvents([evidenceDet("s1", 36.95, 28.65, { frp: 10 })]),
    25,
    EVIDENCE_REF,
    [],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].evidence, null);
});

test("evidence: export CSV exposes snake_case columns and GeoJSON risky-line features", () => {
  const prevCountry = A.CONFIG.activeCountryCode;
  A.CONFIG.activeCountryCode = "TR";
  const gr = evidenceGrid([EVIDENCE_LINE]);
  const out = gr.analyzeEvents(
    evidenceEvents([evidenceDet("e1", 36.95, 28.64, { frp: 25 })]),
    25,
    EVIDENCE_REF,
    [],
  );
  let download;
  const original = U.download;
  U.download = (name, type, content) => {
    download = { name, type, content };
  };
  const state = {
    countryCode: "TR",
    selectedTime: new Date("2026-08-05T12:00:00Z"),
    fireData: [],
    fireEvents: out.map((a) => a.event),
    fireImpacts: out,
    smokeData: [],
    windData: [],
    surfaceWindData: [],
  };
  A.ExportManager.csv(state);
  for (const col of [
    "triggerDetectionId",
    "triggerSource",
    "triggerSatellite",
    "triggerInstrument",
    "triggerProduct",
    "triggerDetectedAt",
    "triggerFrpMw",
    "triggerConfidence",
    "triggerLatitude",
    "triggerLongitude",
    "triggerDistanceKm",
    "nearestLineLatitude",
    "nearestLineLongitude",
    "eventCenterLatitude",
    "eventCenterLongitude",
    "evidenceCount",
    "selectionRule",
  ])
    assert.ok(download.content.includes(col), `CSV column ${col}`);
  assert.ok(download.content.includes("e1"), "CSV row contains the trigger id");
  A.ExportManager.geojson(state);
  const gj = JSON.parse(download.content);
  const risky = gj.features.filter((f) => f.properties.kind === "risky_line_segment");
  assert.equal(risky.length, 1);
  assert.equal(risky[0].geometry.type, "LineString");
  assert.equal(risky[0].properties.triggerDetectionId, "e1");
  assert.equal(risky[0].properties.triggerFrpMw, 25);
  assert.equal(risky[0].properties.selectionRule, "nearest_raw_detection");
  assert.ok(Number.isFinite(risky[0].properties.nearestLineLatitude));
  assert.equal(
    risky[0].properties.assetId,
    out[0].evidence.lineId,
    "GeoJSON risky segment is associated with the exact analysed line",
  );
  assert.equal(risky[0].properties.eventId, out[0].event.id);
  const lineCoords = [
    [risky[0].geometry.coordinates[0][0], risky[0].geometry.coordinates[0][1]],
    [risky[0].geometry.coordinates[1][0], risky[0].geometry.coordinates[1][1]],
  ];
  assert.ok(
    lineCoords.every((c) =>
      EVIDENCE_LINE.geometry.coordinates.some(
        (f) => Math.abs(f[0] - c[0]) < 1e-6 && Math.abs(f[1] - c[1]) < 1e-6,
      ),
    ),
    "GeoJSON segment coordinates belong to the EVIDENCE_LINE geometry",
  );
  const j = A.ExportManager.json(state);
  assert.ok(download.content.includes('"evidence"'), "JSON dump keeps evidence objects");
  U.download = original;
  A.CONFIG.activeCountryCode = prevCountry;
});

test("export: CSV formula injection is neutralized while real values survive", () => {
  assert.equal(U.csvEscape("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(U.csvEscape("+cmd|calc"), "'+cmd|calc");
  assert.equal(U.csvEscape("@SUM"), "'@SUM");
  assert.equal(U.csvEscape("-2+3"), "'-2+3");
  assert.equal(U.csvEscape("36.95,28.64"), '"36.95,28.64"');
  assert.equal(U.csvEscape('"quoted"'), '"""quoted"""');
  assert.equal(U.csvEscape("-9.5"), "-9.5", "negative numbers stay numeric");
  assert.equal(U.csvEscape("45"), "45");
});

test("evidence: new i18n keys exist in both locales", () => {
  for (const key of [
    "layers.riskEvidence",
    "layers.riskEvidenceHint",
    "analysis.source",
    "analysis.evidence",
    "analysis.showEvidence",
    "analysis.showEvidenceShort",
    "detail.riskEvidence",
    "detail.triggerSource",
    "detail.triggerSatellite",
    "detail.triggerInstrument",
    "detail.triggerTime",
    "detail.frp",
    "detail.dayNight",
    "detail.triggerDistance",
    "detail.triggerCoords",
    "detail.nearestLinePoint",
    "detail.eventCenterCoords",
    "detail.evidenceCount",
    "detail.selectionRule",
    "detail.evidenceSpatialFail",
    "detail.clusterCenterNote",
    "map.evidenceTitle",
    "map.evidencePixel",
    "map.evidenceLink",
    "map.evidenceNearest",
    "map.eventClusterCenter",
    "map.evidenceTriggerTooltip",
    "map.evidenceNearestTooltip",
  ]) {
    assert.ok(A.I18n.t(key) !== key, `TR has ${key}`);
    I.locale = "en";
    assert.ok(A.I18n.t(key) !== key, `EN has ${key}`);
    I.locale = "tr";
  }
});

{
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  tests.push({
    name: "server: GR /api/firms bbox validation",
    fn: async () => {
      const port = 8900 + Math.floor(Math.random() * 900);
      const child = spawn(process.execPath, ["server.mjs"], {
        env: { ...process.env, PORT: String(port), FIRMS_MAP_KEY: "test_key", AUTO_OPEN: "0" },
        stdio: "ignore",
      });
      const base = `http://127.0.0.1:${port}`;
      try {
        let ready = false;
        for (let i = 0; i < 50; i++) {
          try {
            const health = await fetch(`${base}/api/health`);
            if (health.ok) {
              ready = true;
              break;
            }
          } catch {}
          await sleep(200);
        }
        assert.ok(ready, "server started within 10s");
        const inBounds = await fetch(`${base}/api/firms?country=GR&bbox=21.5,35.5,26.5,39.5&source=VIIRS_NOAA21_NRT&days=2`);
        const inText = await inBounds.text();
        assert.ok(!inText.includes("bbox must stay inside"), "GR in-bounds bbox must pass local validation");
        const outBounds = await fetch(`${base}/api/firms?country=GR&bbox=21.5,35.5,30,39.5&source=VIIRS_NOAA21_NRT&days=2`);
        assert.equal(outBounds.status, 400, "GR out-of-bounds bbox must be rejected");
        const outText = await outBounds.text();
        assert.ok(outText.includes("bbox must stay inside"), "400 body names the bbox rule");
        const trOnly = await fetch(`${base}/api/firms?country=GR&bbox=27.5,37,41,40&source=VIIRS_NOAA21_NRT&days=2`);
        assert.equal(trOnly.status, 400, "TR-only bbox must be rejected for GR");
      } finally {
        child.kill();
      }
    },
  });
}

test("computeMultiSensorMetrics correctly counts >=2 sensor logic", () => {
  const events = [
    { independentSensorCount: 1, sensorFamilies: ["viirs"] },
    { independentSensorCount: 2, sensorFamilies: ["viirs", "slstr"] },
    { independentSensorCount: 3, sensorFamilies: ["viirs", "slstr", "fci"] },
    { independentSensorCount: 1, sensorFamilies: ["modis"] },
    { independentSensorCount: 2, sensorFamilies: ["modis", "fci"] }
  ];
  const ms = A.ThermalSources.computeMultiSensorMetrics(events);
  assert.equal(ms.associationGroupCount, 5);
  assert.equal(ms.confirmedEventCount, 3);
  assert.equal(ms.singleSensorGroupCount, 2);
  assert.equal(ms.twoSensorEventCount, 2);
  assert.equal(ms.threePlusSensorEventCount, 1);
});

test("computeMultiSensorMetrics ignores single-sensor events for confirmedByProduct/Source", () => {
  const events = [
    {
      id: "ev1",
      independentSensorCount: 1,
      sensorFamilies: ["viirs-modis"],
      observations: [{ product: "VIIRS" }],
      supportingSources: ["firms"]
    },
    {
      id: "ev2",
      independentSensorCount: 2,
      sensorFamilies: ["viirs-modis", "slstr"],
      observations: [{ product: "VIIRS" }, { product: "SLSTR" }],
      supportingSources: ["firms", "s3"]
    }
  ];
  const ms = A.ThermalSources.computeMultiSensorMetrics(events);
  assert.equal(ms.confirmedByProduct["VIIRS"], 1);
  assert.equal(ms.confirmedByProduct["SLSTR"], 1);
  assert.equal(ms.confirmedBySource["firms"], 1);
  assert.equal(ms.confirmedBySource["s3"], 1);
});

test("thermal-association correctly computes latestDetectedAt", () => {
  const sources = {
    "nasa-firms": [{ lat: 38, lon: 28, detectedAt: "2024-01-01T10:00:00Z", frpMw: 10, sensorFamily: "viirs-modis" }],
    "sentinel3a-slstr": [{ lat: 38, lon: 28, detectedAt: "2024-01-01T10:10:00Z", frpMw: 15, sensorFamily: "slstr" }],
    "mtg-fci-frp": [{ lat: 38, lon: 28, detectedAt: "2024-01-01T10:05:00Z", frpMw: 12, sensorFamily: "mtg" }]
  };
  const events = A.ThermalAssociation.associateAcrossSources({ bySource: sources });
  assert.equal(events.length, 1);
  assert.equal(events[0].detectedAt, "2024-01-01T10:00:00Z");
  assert.equal(events[0].latestDetectedAt, "2024-01-01T10:10:00Z");
});

test("eumetview-wfs: cqlBbox uses south,west,north,east order", () => {
  const cql = window.AtmoApp.EumetviewWfs.cqlBbox([25.6, 35.75, 44.9, 42.2]);
  assert.equal(cql, "BBOX(geom, 35.75, 25.6, 42.2, 44.9)", "cqlBbox axis order must be EPSG:4326 (lat,lon) / south,west,north,east");
});

test("thermal-sources: normalizeFireDetection maps coordinates properly from Lat/Lon and geometry", () => {
  const rawProperties = { lat: 38.5, lon: 27.2 };
  const normalized = U.normalizeFireDetection(rawProperties);
  assert.equal(normalized.lat, 38.5, "normalized lat should be 38.5");
  assert.equal(normalized.lon, 27.2, "normalized lon should be 27.2");
});

test("map: mtgDetectionPopup includes both MIR and TIR separately and formats % confidence", () => {
  const mtgPopupFn = window.AtmoApp.MapManager.prototype.mtgDetectionPopup;
  const fullFeature = {
    frp: 82.4,
    confidenceRaw: 85,
    brightnessTemperatureMirK: 305.2,
    brightnessTemperatureTirK: 290.1,
    detectedAt: "2024-08-08T10:00:00Z"
  };
  const popupHtml = mtgPopupFn(fullFeature);
  assert.equal(popupHtml.includes("85%"), true, "Must include % confidence");
  assert.equal(popupHtml.includes("305.2 K"), true, "Must include MIR BT");
  assert.equal(popupHtml.includes("290.1 K"), true, "Must include TIR BT");
  assert.equal(popupHtml.includes("BT MIR"), true, "Must include MIR label");
  assert.equal(popupHtml.includes("BT TIR"), true, "Must include TIR label");
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
