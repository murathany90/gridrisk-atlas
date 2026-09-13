// GridAtlas 3D v0.6 — src/core/bus.js
// Faz 3: küçük event bus. Tree, 3D, SLD ve detail senkronizasyonu bu olaylar
// üzerinden çalışır; ağır framework/state kütüphanesi yok.
const listeners = new Map();
export const Events = {
  ASSET_SELECTED: 'asset:selected',
  MODE_CHANGED: 'mode:changed',
  TOPOLOGY_CHANGED: 'topology:changed',
  MEASUREMENTS_UPDATED: 'measurements:updated',
  PATH_CHANGED: 'path:changed',
  LANGUAGE_CHANGED: 'language:changed',
  COUNTRY_CHANGED: 'country:changed'
};
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}
export function emit(type, payload) {
  const subs = listeners.get(type);
  if (!subs) return;
  for (const fn of [...subs]) fn(payload);
}
