#!/usr/bin/env node
/**
 * EUMETView WFS FRP pilot probe
 *
 * Kontrollü pilot: mtg_fd:frp adını doğrulamadan etkinleştirme. Bu araç:
 *   1. WFS GetCapabilities
 *   2. FRP içeren katmanları listeleme
 *   3. Uygun katman için DescribeFeatureType
 *   4. Küçük bbox + kısa zaman aralığıyla GetFeature
 * işlemlerini yapar ve bulguları JSON olarak raporlar.
 *
 * Kullanım: node tools/probe_eumetview_frp.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const DEFAULT_BASE = "https://view.eumetsat.int/geoserver/ows";

function readConfigBase() {
  try {
    const text = fs.readFileSync(
      path.join(repoRoot, "js", "config.js"),
      "utf8",
    );
    const m = text.match(/base:\s*'([^']+)'/);
    return m ? m[1] : DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

const BASE = process.env.EUMETVIEW_WFS_BASE || readConfigBase();
const VERSION = process.env.WFS_VERSION || "2.0.0";
const BBOX = process.env.PROBE_BBOX || "25.6,35.75,44.9,42.2";
const TIMEOUT_MS = 30000;

async function httpGet(url, accept = "application/json") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: accept },
      redirect: "follow",
    });
    const corsHeader = res.headers.get("access-control-allow-origin");
    return {
      status: res.status,
      ok: res.ok,
      cors: corsHeader,
      contentType: res.headers.get("content-type") || "",
      text: await res.text(),
    };
  } catch (e) {
    const reason = e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e);
    return { status: 0, ok: false, cors: null, contentType: "", text: "", error: reason };
  } finally {
    clearTimeout(timer);
  }
}

function parseCapabilities(xml) {
  const blocks = [];
  const re = /<FeatureType\b[^>]*>([\s\S]*?)<\/FeatureType>/gi;
  let m;
  while ((m = re.exec(xml))) blocks.push(m[1]);
  const out = [];
  for (const block of blocks) {
    const name = (block.match(/<Name>([^<]+)<\/Name>/) || [])[1];
    const title = (block.match(/<Title>([^<]*)<\/Title>/) || [])[1] || "";
    const keywords = (block.match(/<Keywords>\s*<Keyword>([^<]+)<\/Keyword>/gi) || []).map(
      (k) => (k.match(/<Keyword>([^<]+)<\/Keyword>/i) || [])[1] || "",
    );
    if (name) out.push({ name, title: title.trim(), keywords });
  }
  return out;
}

function looksLikeFrpLayer(layer) {
  const hay = `${layer.name} ${layer.title} ${layer.keywords.join(" ")}`.toLowerCase();
  return hay.includes("frp") || hay.includes("fire");
}

function layerDescriptor(layer) {
  const fields = {};
  for (const ft of layer.featureTypes || []) {
    for (const p of ft.properties || []) fields[p.name] = p.type || "";
  }
  return {
    name: layer.name,
    featureCount: layer.featureCount ?? null,
    fields: Object.keys(fields),
    fieldTypes: fields,
    hasFrpField: Object.keys(fields).some((k) =>
      /^frp/i.test(k) || /fire.?radiative.?power/i.test(k),
    ),
    hasGeometry: Object.keys(fields).includes("geom"),
    hasTimeField: Object.keys(fields).includes("time") || Object.keys(fields).some((k) => /time/i.test(k)),
  };
}

function newestObservation(features) {
  let newest = null;
  for (const f of features || []) {
    const t = f.properties && (f.properties.time || f.properties.TIME || f.properties.Datetime);
    if (t && (newest == null || new Date(t) > new Date(newest))) newest = t;
  }
  return newest;
}

function fieldPresence(features) {
  const sample = features && features[0] && features[0].properties ? features[0].properties : {};
  const names = Object.keys(sample);
  return {
    fields: names,
    hasFrp: names.some((k) => /^frp$/i.test(k) || /fire.?radiative.?power/i.test(k)),
    hasLatLon: names.some((k) => /^lat$/i.test(k)) && names.some((k) => /^lon$/i.test(k)),
    hasGeometry: !!(features && features[0] && features[0].geometry),
    hasTime: names.some((k) => /time/i.test(k)),
  };
}

function iso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3600e3).toISOString();
}

async function main() {
  const report = { base: BASE, version: VERSION, generatedAt: new Date().toISOString() };
  const steps = [];

  // 1. GetCapabilities
  const capsUrl = `${BASE}?service=WFS&version=${VERSION}&request=GetCapabilities`;
  const caps = await httpGet(capsUrl, "application/xml");
  steps.push({
    step: "GetCapabilities",
    url: capsUrl,
    httpStatus: caps.status,
    cors: caps.cors,
    ok: caps.ok,
    error: caps.error || null,
  });
  report.httpStatus = caps.status;
  report.cors = caps.cors;
  if (!caps.ok) {
    report.ok = false;
    report.error = caps.error || `HTTP ${caps.status}`;
    report.rootCause = "GetCapabilities başarısız — EUMETView WFS erişilemiyor.";
    console.log(JSON.stringify({ ...report, steps }, null, 2));
    process.exit(caps.status === 0 ? 2 : 1);
  }
  const layers = parseCapabilities(caps.text);
  report.layerCount = layers.length;
  const frpLayers = layers.filter(looksLikeFrpLayer);
  report.frpLayers = frpLayers.map((l) => ({ name: l.name, title: l.title }));

  const selected = frpLayers.find((l) => l.name.toLowerCase().includes("frp")) || frpLayers[0] || null;
  report.selectedLayer = selected ? selected.name : null;
  if (!selected) {
    report.ok = false;
    report.rootCause =
      "EUMETView WFS GetCapabilities içinde FRP/fire içerikli katman bulunamadı; isim uydurulmadı ve config açılmadı.";
    console.log(JSON.stringify({ ...report, steps }, null, 2));
    process.exit(3);
  }

  // 3. DescribeFeatureType
  const dftUrl = `${BASE}?service=WFS&version=${VERSION}&request=DescribeFeatureType&typeNames=${encodeURIComponent(selected.name)}&outputFormat=application/json`;
  const dft = await httpGet(dftUrl);
  steps.push({
    step: "DescribeFeatureType",
    typeNames: selected.name,
    httpStatus: dft.status,
    cors: dft.cors,
    ok: dft.ok,
    error: dft.error || null,
  });
  let descriptor = null;
  if (dft.ok && dft.text.trim().startsWith("{")) {
    try {
      descriptor = layerDescriptor(JSON.parse(dft.text));
    } catch {
      descriptor = null;
    }
  }
  report.describeFeatureType = descriptor;

  // 4. GetFeature: küçük bbox + kısa zaman aralığı
  const attempts = [
    { label: "son 6 saat", from: iso(6), to: iso(0) },
    { label: "son 48 saat", from: iso(48), to: iso(0) },
    { label: "son 14 gün", from: iso(24 * 14), to: iso(0) },
  ];
  const getFeatureResults = [];
  let chosen = null;
  for (const a of attempts) {
    const gfUrl = `${BASE}?service=WFS&version=${VERSION}&request=GetFeature&typeNames=${encodeURIComponent(selected.name)}&outputFormat=application/json&count=20&cql_filter=${encodeURIComponent(`BBOX(geom, ${BBOX}) AND time >= '${a.from}' AND time <= '${a.to}'`)}`;
    const gf = await httpGet(gfUrl);
    let features = null;
    let parseError = null;
    if (gf.ok) {
      try {
        const data = JSON.parse(gf.text);
        if (data && data.type === "FeatureCollection") features = data.features || [];
        else parseError = "yanıt FeatureCollection değil";
      } catch {
        parseError = "yanıt JSON değil";
      }
    }
    const result = {
      label: a.label,
      from: a.from,
      to: a.to,
      httpStatus: gf.status,
      cors: gf.cors,
      ok: gf.ok,
      featureCount: features ? features.length : null,
      newestObservation: features ? newestObservation(features) : null,
      fields: features ? fieldPresence(features) : null,
      parseError,
      error: gf.error || null,
    };
    getFeatureResults.push(result);
    if (!chosen && features && features.length) chosen = result;
    if (features && features.length && a.label === "son 6 saat") break;
  }
  report.getFeature = { attempts: getFeatureResults, chosen: chosen ? chosen.label : null };

  const g = chosen || getFeatureResults[0] || {};
  const ok =
    g.ok && g.featureCount != null && (g.featureCount > 0 || g.parseError == null) &&
    !!(g.fields && g.fields.hasFrp && (g.fields.hasLatLon || g.fields.hasGeometry) && g.fields.hasTime);
  report.ok = ok;
  if (!ok) {
    report.rootCause = chosen
      ? `GetFeature döndü ancak şema/alanlar beklendiği gibi değil: ${JSON.stringify(chosen.fields || {})}`
      : `GetFeature hiçbir zaman aralığında geçerli veri döndürmedi (son 6s/48s/14g); son durum: ${getFeatureResults[getFeatureResults.length - 1]?.httpStatus}`;
  } else {
    report.rootCause = null;
  }
  report.steps = steps;
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 4);
}

main().catch((e) => {
  console.error("probe hatası:", e);
  process.exit(9);
});
