// GridAtlas 3D v0.4 — src/integration/parentBridge.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
// Parent <-> GridAtlas3D koprusu (Faz 1: mevcut davranis korunur).
// - gridatlas-visibility destegi aynen korunur (same-origin kontrollu).
// - embed/country/lang sorgu parametreleri okunur ve saklanir (Faz 3'te canli uygulanacak).
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const parentParams = {
  embed: params.get('embed'),
  country: (params.get('country') || 'TR').toUpperCase(),
  lang: (params.get('lang') || 'tr').toLowerCase()
};
let parentVisible = true;
export const isParentVisible = () => parentVisible;
export function initParentBridge() {
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'gridatlas-visibility') return;
    parentVisible = event.data.visible !== false;
  });
}
