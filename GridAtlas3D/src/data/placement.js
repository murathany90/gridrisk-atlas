// GridAtlas 3D v0.6 — src/data/placement.js
// Faz 3: 3D yerleşim katmanı. Elektriksel model (station.js) bağlantıları,
// bu modül saha koordinatlarını, sld.js tek-hat koordinatlarını tutar.
// TM-01 dışındaki istasyonlar aynı motora yeni electrical + placement
// çiftleriyle eklenebilir; mevcut TM-01 değerleri değişmez.
const placements = new Map();
export function place(tag, x, z) { placements.set(tag, { x, z }); }
export function placementOf(asset) {
  const tag = typeof asset === 'string' ? asset : asset?.tag;
  return placements.get(tag) ?? { x: 0, z: 0 };
}
