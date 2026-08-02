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
  assert.match(source.ui, /dispatchEvent\(new Event\("change", \{ bubbles: true \}\)/);
  assert.match(source.ui, /aria-pressed/);
  assert.match(source.ui, /closeQuickLayers\(\)/);
  assert.match(source.ui, /popstate/);
  assert.match(source.ui, /Escape/);
  assert.match(source.ui, /pointerdown/);
  assert.match(source.ui, /syncQuickLayers\(\)/);
  assert.match(css, /\.quickLayersFab/);
  assert.match(css, /max-width: 190px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /min-width: 48px/);
  assert.match(css, /max-width: 760px/);
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
