// GridAtlas 3D v0.5 — src/ui/sidebar.js
// Faz 2: moda bağlı sekmeli sol çalışma alanı (Varlıklar / Ekipman / Görünüm …).
// Paneller mevcut veri ve hesapları salt okur; elektriksel model değişmez.
import { $, $$, esc, clamp, bayName } from '../core/utils.js';
import { state } from '../core/state.js';
import { on, Events } from '../core/bus.js';
import { get, rootAsset, electrical, edges, switchTypes, voltageText, stateText } from '../data/station.js';
import { trainingConfig, formatSignal, signalSpec } from '../electrical/electrical.js';

const TABS = {
  inspect: [['assets', 'Varlıklar'], ['equipment', 'Ekipman'], ['view', 'Görünüm']],
  topology: [['assets', 'Varlıklar'], ['links', 'Bağlantılar'], ['path', 'Enerji Yolu']],
  analysis: [['assets', 'Varlıklar'], ['analysis', 'Analiz'], ['measure', 'Ölçümler']],
  training: [['scenario', 'Senaryo'], ['steps', 'Adımlar'], ['trainequip', 'Ekipman']]
};
function tabsForMode() { return TABS[state.mode] || TABS.inspect; }
function renderSidebarTabs() {
  const tabs = tabsForMode();
  if (!tabs.some(([k]) => k === state.leftTab)) state.leftTab = tabs[0][0];
  $('#mode-tabs').innerHTML = tabs.map(([k, label]) => `<button role="tab" data-left-tab="${k}" aria-selected="${k === state.leftTab}">${label}</button>`).join('');
  syncSidePanels();
  renderScenarioPanel();
  refreshSidePanels();
}
function setLeftTab(name) {
  const tabs = tabsForMode();
  if (!tabs.some(([k]) => k === name)) name = tabs[0][0];
  state.leftTab = name;
  syncSidePanels();
}
function syncSidePanels() {
  $$('#mode-tabs [data-left-tab]').forEach(b => { const on = b.dataset.leftTab === state.leftTab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  $$('.left-body [data-left-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.leftPanel !== state.leftTab));
}
function sideHint(text) { return `<p class="muted side-hint">${text}</p>`; }
function measureKeys(root) { return root.type === 'transformer' ? ['p', 'q', 'loading', 'tap'] : root.ratingMvar ? ['voltage', 'q', 'loading', 'current'] : ['voltage', 'current', 'p', 'q']; }
function renderMeasurePanel() {
  const el = $('#side-measure'); if (!el) return;
  const a = get(state.selected), root = rootAsset(a);
  if (!root || !root.measurements.voltage) { el.innerHTML = sideHint('Ölçüm için bir ekipman seçin.'); return; }
  const keys = measureKeys(root);
  el.innerHTML = `<div class="side-asset">${esc(root.name)} <span class="mono">${esc(root.tag)}</span></div><div class="measure-rows">` + keys.map(k => {
    const spec = signalSpec[k];
    return `<div class="measure-row" data-mkey="${k}"><span>${spec.label}</span><b class="mono">— <small>${spec.unit}</small></b><span class="quality">—</span></div>`;
  }).join('') + `</div>`;
  updateMeasureValues(root);
}
function updateMeasureValues(root) {
  root = root || rootAsset(get(state.selected));
  const el = $('#side-measure');
  if (!el || !root || !root.measurements.voltage) return false;
  const rows = [...el.querySelectorAll('.measure-row')];
  const keys = measureKeys(root);
  if (rows.length !== keys.length || !rows.every((r, i) => r.dataset.mkey === keys[i])) return false;
  rows.forEach((r, i) => {
    const k = keys[i], m = root.measurements[k], spec = signalSpec[k];
    const val = m && m.quality !== 'INVALID' ? m.value.toFixed(spec.digits) : '—';
    const q = m ? m.quality : '—';
    r.querySelector('b').innerHTML = `${val} <small>${spec.unit}</small>`;
    const qel = r.querySelector('.quality');
    qel.textContent = q;
    qel.classList.toggle('bad', q !== 'GOOD');
  });
  return true;
}
function updateTrainEquipLive() {
  const el = $('#side-trainequip');
  if (!el) return;
  const a = get(state.selected), root = rootAsset(a);
  if (!a || !root) return;
  const strip = el.querySelector('.state-strip');
  if (strip) {
    strip.classList.toggle('off', !root.energized);
    strip.innerHTML = `<span>${root.energized ? '● ENERJİLİ' : '○ ENERJİSİZ'}</span><b class="mono">${stateText(root)}</b>`;
  }
}
function renderLinksPanel() {
  const el = $('#side-links'); if (!el) return;
  const a = get(state.selected);
  if (!a) { el.innerHTML = sideHint('Bağlantılar için bir ekipman seçin.'); return; }
  el.innerHTML = `<div class="side-asset">${esc(a.name)} <span class="mono">${esc(a.tag)}</span></div><div class="eyebrow">BAĞLI EKİPMANLAR · ${a.connections.length}</div><div class="links-list">` +
    a.connections.map(id => { const c = get(id); return `<button data-asset="${id}" title="${esc(c.name + ' · ' + c.tag)}"><b>${esc(c.name)}</b><small class="mono">${esc(c.tag)} · ${voltageText(c)} kV · ${stateText(c)}</small></button>`; }).join('') + `</div>`;
}
function renderPathPanel() {
  const el = $('#side-path'); if (!el) return;
  const ids = [...state.pathIds];
  el.innerHTML = `<button data-action="energy" class="${state.path ? 'active' : ''}" aria-pressed="${state.path}" style="width:100%">ϟ ENERJİ YOLU ${state.path ? 'AÇIK' : 'KAPALI'}</button>` +
    (state.path ? `<div class="eyebrow">YOL ÜZERİNDEKİ EKİPMAN · ${ids.length}</div><div class="links-list path-list">` + ids.slice(0, 60).map(id => { const c = get(id); return c ? `<button data-asset="${id}"><b>${esc(c.tag)}</b><small>${esc(c.name)}</small></button>` : ''; }).join('') + (ids.length > 60 ? `<p class="muted">… ve ${ids.length - 60} ekipman daha</p>` : '') + `</div>` : sideHint('Enerji yolu, seçili ekipmanın bağlı terminal bileşenini gösterir; açık kontaklarda durur.'));
}
function renderScenarioPanel() {
  const el = $('#side-scenario'); if (!el) return;
  el.innerHTML = `<p><span class="pill warn">SIMULATION ONLY</span></p><p class="muted">Fider kesicisini açın; varsa ayırıcıları açarak fideri izole edin. Topraklı fiderde önce toprak bağlantısını ayırın.</p><div class="demo-grid"><button data-demo="normal">● Normal İşletme</button><button data-demo="trip">↯ Hat Açması</button><button data-demo="transfer">⇄ Bara Transferi</button><button data-demo="alarm">! Trafo Alarmı</button><button data-demo="quality">◷ Veri Kalitesi</button><button data-demo="reverse">⇄ Ters Aktif Güç</button><button data-action="replay">▶ Arıza Tekrarı</button></div><small class="muted">Yerel eğitim modeli · Gerçek kumanda yok.</small>`;
}
function renderTrainEquipPanel() {
  const el = $('#side-trainequip'); if (!el) return;
  const a = get(state.selected), root = rootAsset(a);
  if (!a) { el.innerHTML = sideHint('Fiderdeki bir kesici veya ayırıcıyı seçin.'); return; }
  const sw = switchTypes.includes(a.type) ? a : (root && switchTypes.includes(root.type) ? root : null);
  el.innerHTML = `<div class="side-asset">${esc(a.name)} <span class="mono">${esc(a.tag)}</span></div><div class="state-strip${root.energized ? '' : ' off'}"><span>${root.energized ? '● ENERJİLİ' : '○ ENERJİSİZ'}</span><b class="mono">${stateText(root)}</b></div>` +
    (sw ? `<button data-action="switch" data-role="switch-command" id="switch-command-side">${sw.state === 'CLOSED' ? 'AÇ' : 'KAPAT'} · ${sw.tag}</button>` : `<p class="muted">Seçili ekipman kumanda edilebilir tipte değil (kesici / ayırıcı seçin).</p>`);
}
const sideCache = { asset: undefined, mode: undefined };
function refreshSidePanels() {
  if (!$('#mode-tabs')) return;
  sideCache.asset = state.selected;
  sideCache.mode = state.mode;
  renderMeasurePanel();
  renderLinksPanel();
  renderPathPanel();
  renderTrainEquipPanel();
}
function updateSideLive() {
  if (!$('#mode-tabs')) return;
  if (sideCache.asset !== state.selected || sideCache.mode !== state.mode) { refreshSidePanels(); return; }
  updateMeasureValues();
  updateTrainEquipLive();
}
on(Events.MODE_CHANGED, () => { renderSidebarTabs(); });
on(Events.TOPOLOGY_CHANGED, () => { renderPathPanel(); });
on(Events.MEASUREMENTS_UPDATED, () => { updateSideLive(); });
function initSidebarResize() {
  const handle = document.querySelector('[data-resize="right"]');
  if (!handle || handle.dataset.bound) return;
  handle.dataset.bound = '1';
  handle.addEventListener('pointerdown', e => {
    if (innerWidth <= 900 || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    const move = ev => {
      const w = clamp(document.documentElement.clientWidth - ev.clientX, 300, 520);
      document.documentElement.style.setProperty('--right', w + 'px');
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

export { renderSidebarTabs, setLeftTab, syncSidePanels, refreshSidePanels, updateSideLive, initSidebarResize };
