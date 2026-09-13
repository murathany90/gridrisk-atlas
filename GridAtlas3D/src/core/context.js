// GridAtlas 3D v0.4 — src/core/context.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
// Ortak calisma zamani durumu (Faz 1: eski global degiskenlerin kontrollu karsiligi).
// Faz 3'te event-bus ile degistirilecek teknik borc notu ile korunur.
export const ctx = {
  renderer: undefined, scene: undefined, camera: undefined, ground: undefined,
  structures: undefined, underground: undefined, groundGrid: undefined, trenches: undefined,
  zoneGroup: undefined, debugGroup: undefined, measureGroup: undefined,
  selectionBox: undefined, hoverBox: undefined, canvas: undefined, resizeObserver: undefined,
  assetGroups: new Map(), parts: [], phaseGroups: [], movingContacts: [], wires: [],
  worldLabels: [], pickables: [], geoCache: new Map(), allMaterials: new Set(),
  spreadAmount: 1, explodeAmount: 0,
  adjacency: new Map(), liveTerminals: new Set()
};
