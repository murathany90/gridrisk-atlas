// GridAtlas 3D v0.5 — src/sld/sld.js
// Faz 2: gerçek yukarıdan-aşağı dikey tek-hat şeması (sağ sidebar).
// Aynı assets/edges verisinden üretilir; elektriksel model değişmez.
import { $, esc, clamp } from '../core/utils.js';
import { get, electrical, assets, edges, bays } from '../data/station.js';
import { on, Events } from '../core/bus.js';

// SLD — SVG symbols generated from the same assets and edges.
const sldPositions = new Map();
const sldSpans = new Map();
function sldPosition(tag, x, y) { sldPositions.set(get(tag).assetId, { x, y }); }
function sldSpanOf(asset) { return sldSpans.get(asset.assetId); }
function buildSLD() {
  sldPositions.clear();
  const put = (tag, x, y) => sldPosition(tag, x, y);
  const col = (tags, x, y0, step) => tags.forEach((t, i) => put(t, x, y0 + i * step));
  const BUS_X = 280, BUS_SPAN = [-240, 240];
  // 400 kV hat fiderleri: şalt tarafı üstte, hat alta iner.
  const fxs = [70, 200, 330, 460];
  for (const bay of bays.filter(b => b.kind === 'line' && b.voltage === 400)) {
    const a = get(bay.line), i = bay.index - 1, x = fxs[i], code = 400 + i * 10, y0 = 100, st = 100;
    col([a.terminalTower, a.portal, a.tag, 'LA-' + (code + 1), 'CVT-' + (code + 1), 'LT-' + (code + 1), 'DS-' + (code + 1), 'CT-' + (code + 1), bay.breaker, bay.dsA], x, y0, st);
    put(bay.dsB, x, y0 + 10 * st);
    put(bay.earth, x + (i % 2 ? 48 : -48), y0 + 6 * st);
  }
  for (const [tag, y] of [['BUS-400-A', 1180], ['BUS-400-B', 1240]]) { put(tag, BUS_X, y); sldSpans.set(get(tag).assetId, BUS_SPAN); }
  col(['DS-490', 'COUPLER-400', 'DS-491'], 280, 1180, 30);
  col(['DS-581', 'CB-581', 'CT-581', 'LA-581', 'REACTOR-400'], 505, 1180, 98);
  for (const tr of electrical.filter(a => a.subtype === 'autotransformer')) {
    const n = tr.tag.endsWith('1') ? 0 : 1, x = n ? 410 : 150, code = 510 + n * 10;
    col(['DS-' + code, 'CB-' + code, 'CT-' + code, 'LA-' + code, tr.tag, 'CB-' + (code + 1), 'CT-' + (code + 1), 'DS-' + (code + 1)], x, 1180, 98);
  }
  for (const [tag, y] of [['BUS-154-A', 1950], ['BUS-154-B', 2010]]) { put(tag, BUS_X, y); sldSpans.set(get(tag).assetId, BUS_SPAN); }
  col(['DS-290', 'COUPLER-154', 'DS-291'], 280, 1950, 30);
  col(['DS-681', 'CB-681', 'CT-681', 'CAP-154'], 505, 1950, 98);
  // 154 kV hat fiderleri: bara üstte, hat alta iner.
  const gxs = [46, 130, 214, 298, 382, 466];
  for (const bay of bays.filter(b => b.kind === 'line' && b.voltage === 154)) {
    const a = get(bay.line), i = bay.index - 1, x = gxs[i], code = 150 + i * 10, y0 = 2110, st = 92;
    col([bay.dsA, bay.breaker, 'CT-' + (code + 1), 'VT-' + (code + 1), 'LA-' + (code + 1), 'DS-' + (code + 1), a.tag, a.portal, a.terminalTower], x, y0, st);
    put(bay.dsB, x + 40, y0);
    put(bay.earth, x + (i % 2 ? 44 : -40), y0 + 5 * st);
  }
  // 154/33 kV güç trafoları: fider kolon aralarından beslenir.
  const txs = [88, 256, 424];
  electrical.filter(a => a.subtype === 'powerTransformer').forEach((tr, k) => {
    const i = Number(tr.tag.slice(-1)), code = 600 + i * 10, x = txs[k] ?? 256;
    col(['DS-' + code, 'CB-' + code, 'CT-' + code, 'LA-' + code, tr.tag, 'CABLE-33-IN' + i], x, 2960, 92);
  });
  // 33 kV OG bölümleri.
  for (let i = 0; i < 3; i++) {
    const letter = 'ABC'[i], x = txs[i];
    col(['CB-33-IN' + (i + 1), 'VT-33-' + letter], x, 3500, 92);
    put('BUS-33-' + letter, x, 3684); sldSpans.set(get('BUS-33-' + letter).assetId, [-60, 60]);
    for (let j = 1; j <= 2; j++) {
      const n = i * 2 + j, ox = x + (j === 1 ? -38 : 38), oy = 3760 + (j === 1 ? 0 : 44);
      col(['CB-33-OUT' + n, 'CABLE-33-OUT' + n], ox, oy, 76);
    }
  }
  put('COUPLER-33-AB', 172, 3684); put('COUPLER-33-BC', 340, 3684);
  put('CONTROL-154', 88, 3970); put('BUILDING-33', 300, 3970);
  const svg = $('#sld');
  svg.setAttribute('viewBox', '0 0 560 4080');
  svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
  let html = '';
  const anchor = (asset, p, other) => { const span = sldSpanOf(asset); return span ? { x: clamp(other.x, p.x + span[0], p.x + span[1]), y: p.y } : p; };
  edges.forEach((e, i) => {
    const aa = get(e.a), bb = get(e.b), ap = sldPositions.get(e.a), bp = sldPositions.get(e.b);
    if (!ap || !bp) return;
    const a = anchor(aa, ap, bp), b = anchor(bb, bp, ap);
    let d;
    if (a.x === b.x) d = `M${a.x} ${a.y} V${b.y}`;
    else if (a.y === b.y) d = `M${a.x} ${a.y} H${b.x}`;
    else d = `M${a.x} ${a.y} V${b.y} H${b.x}`;
    html += `<path d="${d}" stroke="#111b23" stroke-width="5" fill="none"/><path class="wire" data-edge="${i}" d="${d}"/>`;
    if (sldSpanOf(aa)) html += `<circle cx="${a.x}" cy="${a.y}" r="3" fill="#829f99"/>`;
    if (sldSpanOf(bb)) html += `<circle cx="${b.x}" cy="${b.y}" r="3" fill="#829f99"/>`;
  });
  for (const a of electrical.filter(a => a.type === 'line')) {
    for (const [from, to] of [[a.terminalTower, a.portal], [a.portal, a.tag]]) {
      const p = sldPositions.get(get(from).assetId), q = sldPositions.get(get(to).assetId);
      html += `<path d="M${p.x} ${p.y} V${q.y}" stroke="#607f8b" stroke-dasharray="4 3" fill="none"/>`;
    }
  }
  for (const a of assets) {
    const p = sldPositions.get(a.assetId);
    if (!p) continue;
    const words = a.name.split(' '), lines = [''];
    for (const word of words) { const i = lines.length - 1; if ((lines[i] + ' ' + word).length > 19 && lines.length < 2) lines.push(word); else lines[i] += (lines[i] ? ' ' : '') + word; }
    const span = sldSpanOf(a);
    const vertical = !span && a.type !== 'structure';
    const symbolMarkup = span ? `<path d="M${span[0]} 0H${span[1]}" stroke-width="5"/>` : symbol(a);
    html += `<g class="asset" data-asset="${a.assetId}" transform="translate(${p.x},${p.y})" role="button" tabindex="0"><title>${esc(a.name + ' · ' + a.tag)}</title><rect class="hit" x="-30" y="-56" width="60" height="124"/><g class="symbol"${vertical ? ' transform="rotate(90)"' : ''}>${symbolMarkup}${a.subtype === 'autotransformer' ? '<path d="M-12 10L13 -12M7 -12H13V-6"/>' : ''}</g><text y="-40" class="sld-tag">${esc(a.tag)}</text>${span ? '' : `<text y="34" class="sld-name">${lines.map((l, i) => `<tspan x="0" dy="${i ? 13 : 0}">${esc(l)}</tspan>`).join('')}</text>`}</g>`;
  }
  svg.innerHTML = html;
}
function symbol(a) {
  const registry = {
    circuitBreaker: '<path d="M-18 0H-7M7 0H18"/><rect x="-7" y="-7" width="14" height="14"/><path class="contact" d="M-5 0H5"/>',
    disconnector: '<path d="M-18 0H-7M7 0H18"/><circle cx="-7" r="1.4"/><circle cx="7" r="1.4"/><path class="contact" d="M-7 0H7"/>',
    earthSwitch: '<path d="M-18 0H-7M7 0H18"/><path class="contact" d="M-7 0H7"/><path d="M10 0v7m-6 0h12m-9 3h6m-4 3h2"/>',
    currentTransformer: '<path d="M-18 0H18"/><circle r="7"/>',
    voltageTransformer: '<path d="M-18 0H18M0 0v6"/><circle cy="7" r="5"/><circle cy="13" r="5"/>',
    arrester: '<path d="M-18 0H18M0 0v4"/><rect x="-4" y="4" width="8" height="10"/><path d="M0 14v4m-6 0h12"/>',
    transformer: '<path d="M-22 0H-14M14 0H22"/><circle cx="-6" r="9"/><circle cx="6" r="9"/>',
    lineTrap: '<path d="M-18 0H-10q2-10 5 0q2-10 5 0q2-10 5 0q2-10 5 0h8"/>',
    line: '<path d="M-18 0H18m-30-5-6 5 6 5"/>', cable: '<path d="M-18 0H18M-7 -5v10M0 -5v10M7 -5v10"/>',
    reactor: '<path d="M-22 0H-15q3-16 7 0q3-16 7 0q3-16 7 0q3-16 7 0H22M22 0v10m-6 0h12m-9 4h6"/>',
    capacitor: '<path d="M-22 0H-5M5 0H22M-5 -12v24M5 -12v24M22 0v14m-6 0h12m-9 4h6"/>'
  };
  return (a.enclosure ? '<rect x="-24" y="-20" width="48" height="42" stroke-dasharray="3 2" stroke-width=".7"/>' : '') + (registry[a.type] || '<circle r="5"/>');
}
function updateSymbol(el, a) { const contact = el.querySelector('.contact'); if (contact) contact.setAttribute('d', a.state === 'OPEN' || a.state === 'OPENING' ? 'M-7 0L5 -9' : 'M-7 0H7'); }

function scrollSldIntoView({ assetId } = {}) {
  if (!assetId) return;
  const a = get(assetId);
  if (!a) return;
  const sldEl = $('#sld [data-asset="' + (a.parent || a.assetId) + '"]');
  if (sldEl) sldEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
on(Events.ASSET_SELECTED, scrollSldIntoView);

export { sldPositions, sldPosition, buildSLD, symbol, updateSymbol, scrollSldIntoView };
