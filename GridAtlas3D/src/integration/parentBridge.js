// GridAtlas 3D v0.6 — src/integration/parentBridge.js
// Faz 3: parent <-> GridAtlas3D köprüsü.
// - gridatlas-visibility desteği aynen korunur (same-origin kontrollü).
// - Parent'tan runtime country / lang / context güncellemesi alınır;
//   iframe ilk açıldıktan sonra da uygulanır (language:changed / country:changed).
import { emit, Events, on } from '../core/bus.js';
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const parentParams = {
  embed: params.get('embed'),
  country: (params.get('country') || 'TR').toUpperCase(),
  lang: (params.get('lang') || 'tr').toLowerCase(),
  context: params.get('context') || ''
};
let parentVisible = true;
export const isParentVisible = () => parentVisible;
const cleanCountry = v => (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null);
const cleanLang = v => (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) ? v.toLowerCase() : null);
function applyContext(data) {
  const country = cleanCountry(data.country);
  if (country && country !== parentParams.country) {
    parentParams.country = country;
    emit(Events.COUNTRY_CHANGED, { country });
  }
  const lang = cleanLang(data.lang);
  if (lang && lang !== parentParams.lang) {
    parentParams.lang = lang;
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    emit(Events.LANGUAGE_CHANGED, { lang });
  }
  if (typeof data.context === 'string' && data.context !== parentParams.context) {
    parentParams.context = data.context;
  }
}
export function initParentBridge() {
  if (typeof document !== 'undefined' && parentParams.lang) document.documentElement.lang = parentParams.lang;
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'gridatlas-visibility') {
      parentVisible = event.data.visible !== false;
      return;
    }
    if (event.data?.type === 'gridatlas-context') {
      applyContext(event.data);
    }
  });
}
on(Events.LANGUAGE_CHANGED, ({ lang } = {}) => {
  if (lang && typeof document !== 'undefined') document.documentElement.lang = lang;
});
