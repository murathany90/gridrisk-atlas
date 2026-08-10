import { test, expect } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const mapLibreMock = `
(() => {
  class FakeMap {
    constructor(options) {
      this.options = options;
      this.sources = {};
      this.layers = {};
      this.handlers = {};
      this.removed = false;
      this.center = { lng: Number(options.center[0]), lat: Number(options.center[1]) };
      this.zoom = Number(options.zoom);
      for (const [id, source] of Object.entries(options.style.sources || {})) this.addSource(id, source);
      for (const layer of options.style.layers || []) this.addLayer(layer);
      window.__terrainMaps = window.__terrainMaps || [];
      window.__terrainMaps.push(this);
      setTimeout(() => {
        this.emit('load');
        const dem = this.sources.terrainSource?.tiles?.[0];
        if (dem) {
          fetch(dem.replace('{z}', '6').replace('{x}', '36').replace('{y}', '24'))
            .then((response) => {
              if (response.ok) this.emit('sourcedata', { sourceId: 'terrainSource', isSourceLoaded: true });
              else for (let count = 0; count < 4; count += 1) this.emit('error', { sourceId: 'terrainSource' });
            })
            .catch(() => { for (let count = 0; count < 4; count += 1) this.emit('error', { sourceId: 'terrainSource' }); });
        }
      }, 0);
    }
    emit(event, payload = {}) { for (const handler of this.handlers[event] || []) handler(payload); }
    on(event, ...args) {
      const handler = args.at(-1);
      if (typeof handler === 'function') (this.handlers[event] ||= []).push(handler);
      return this;
    }
    addSource(id, source) {
      const next = { ...source };
      next.setData = (data) => { next.data = data; };
      this.sources[id] = next;
    }
    getSource(id) { return this.sources[id]; }
    removeSource(id) { delete this.sources[id]; }
    addLayer(layer) { this.layers[layer.id] = { ...layer, paint: { ...(layer.paint || {}) } }; }
    getLayer(id) { return this.layers[id]; }
    removeLayer(id) { delete this.layers[id]; }
    setPaintProperty(id, property, value) { if (this.layers[id]) this.layers[id].paint[property] = value; }
    setTerrain(terrain) { this.terrain = terrain; }
    getTerrain() { return this.terrain; }
    jumpTo(next) {
      const center = next.center;
      if (Array.isArray(center)) this.center = { lng: Number(center[0]), lat: Number(center[1]) };
      else if (center) this.center = { lng: Number(center.lng), lat: Number(center.lat) };
      if (next.zoom !== undefined) this.zoom = Number(next.zoom);
    }
    getCenter() { return this.center; }
    getZoom() { return this.zoom; }
    resize() { this.resizeCount = (this.resizeCount || 0) + 1; }
    remove() { this.removed = true; }
  }
  window.maplibregl = { Map: FakeMap, supported: () => true };
})();
`;

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/?country=TR&lang=tr');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.AtmoApp?.app?.map?.map));
}

async function waitForGrid(page, key = '154') {
  await page.waitForFunction((gridKey) => {
    const manager = window.AtmoApp?.app?.map;
    return Boolean(
      manager?.gridLayers?.get(gridKey) &&
      manager?.gridData?.get(gridKey)?.features?.length,
    );
  }, key, { timeout: 20000 });
}

async function gridStyle(page, key) {
  return page.evaluate((gridKey) => {
    const group = window.AtmoApp.app.map.gridLayers.get(gridKey);
    let style = null;
    group?.eachLayer((layer) => {
      if (!style) style = { color: layer.options.color, weight: layer.options.weight, opacity: layer.options.opacity };
    });
    return style;
  }, key);
}

async function installMapLibreMock(page, { unavailable = false, demFailure = false } = {}) {
  let mapLibreRequests = 0;
  let demRequests = 0;
  await page.route('**/maplibre-gl@6.2.0/dist/maplibre-gl.css', (route) => {
    mapLibreRequests += 1;
    return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });
  await page.route('**/maplibre-gl@6.2.0/dist/maplibre-gl.mjs', (route) => {
    mapLibreRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: unavailable ? 'window.maplibregl={supported:()=>false};' : mapLibreMock,
    });
  });
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**', (route) => {
    demRequests += 1;
    if (demFailure) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing DEM tile' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } });
  });
  return { getMapLibreRequests: () => mapLibreRequests, getDemRequests: () => demRequests };
}

test.describe('FIRE grid contrast and real terrain mode', () => {
  test('keeps 154 kV white throughout FIRE lifecycle and restores the configured black', async ({ page }) => {
    // Initial country/grid hydration can contend with the fully parallel suite.
    // Keep the lifecycle assertions unchanged while allowing that bounded startup work.
    test.slow();
    await page.route('**/geoserver/wms**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.route('**/VIIRS_NOAA21_CorrectedReflectance_TrueColor**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: png }));
    await boot(page);
    await waitForGrid(page, '154');
    await waitForGrid(page, '400');

    expect((await gridStyle(page, '154')).color).toBe('#111111');
    expect((await gridStyle(page, '400')).color).toBe('#d7191c');

    await page.evaluate(() => window.AtmoApp.app.map.setSatelliteImagery('fire', new Date('2026-08-08T18:40:00Z')));
    await expect.poll(() => gridStyle(page, '154')).toMatchObject({ color: '#ffffff' });
    await page.evaluate(() => {
      const group = window.AtmoApp.app.map.gridLayers.get('154');
      group.eachLayer((layer) => layer.fire('mouseover'));
    });
    expect((await gridStyle(page, '154')).color).toBe('#ffffff');
    await page.evaluate(() => {
      const group = window.AtmoApp.app.map.gridLayers.get('154');
      group.eachLayer((layer) => layer.fire('mouseout'));
    });
    expect((await gridStyle(page, '154')).color).toBe('#ffffff');
    expect((await gridStyle(page, '400')).color).toBe('#d7191c');

    const fireLegend = await page.locator('[data-legend="grid"] .legendLine').allTextContents();
    expect(fireLegend.some((text) => text.includes('154') && text.includes('Siyah'))).toBe(true);
    expect(await page.locator('[data-legend="grid"] .legendLine').filter({ hasText: '154' }).locator('i').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');

    for (const mode of ['live', 'highRes', 'none']) {
      const exitStyle = await page.evaluate((next) => {
        const manager = window.AtmoApp.app.map;
        manager.setSatelliteImagery(next, new Date('2026-08-08T18:40:00Z'));
        let color = null;
        manager.gridLayers.get('154').eachLayer((layer) => { if (color === null) color = layer.options.color; });
        return { mode: manager.satelliteImageryMode, color, effective: manager.getEffectiveGridStyle('154').color };
      }, mode);
      expect(exitStyle).toMatchObject({ mode, color: '#111111', effective: '#111111' });
    }
  });

  test('renders a grid that arrives after FIRE mode in white on its first draw', async ({ page }) => {
    await boot(page);
    await waitForGrid(page, '154');
    await page.evaluate(async () => {
      const manager = window.AtmoApp.app.map;
      const data = structuredClone(manager.gridData.get('154'));
      const layer = manager.gridLayers.get('154');
      manager.map.removeLayer(layer);
      manager.gridLayers.delete('154');
      manager.gridData.delete('154');
      manager.setSatelliteImagery('fire', new Date('2026-08-08T18:40:00Z'));
      await manager.setGridGroup('154', data, true);
    });
    await expect.poll(() => gridStyle(page, '154')).toMatchObject({ color: '#ffffff' });
  });

  test('lazy-loads MapLibre and Terrarium, syncs camera, layers, language, and repeated cleanup', async ({ page }) => {
    const requests = await installMapLibreMock(page);
    await boot(page);
    await waitForGrid(page, '154');
    await waitForGrid(page, '400');
    expect(requests.getMapLibreRequests()).toBe(0);
    expect(requests.getDemRequests()).toBe(0);
    expect(await page.locator('#analysisToggle').evaluate((el) => el.nextElementSibling?.id)).toBe('terrain3dToggle');
    await page.evaluate(() => window.AtmoApp.app.map.setView(37.0, 32.0, 7));

    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#terrain3dToggle')).toContainText('3D Gizle');
    await expect.poll(() => requests.getDemRequests()).toBeGreaterThan(0);
    expect(requests.getMapLibreRequests()).toBe(2);

    const terrain = await page.evaluate(() => {
      const map = window.__terrainMaps.at(-1);
      return {
        terrain: map.getTerrain(),
        source: map.getSource('terrainSource'),
        hillshade: map.getLayer('terrain-hillshade'),
        grid400: map.getSource('grid-400')?.data?.features?.length || 0,
        grid154: map.getSource('grid-154')?.data?.features?.length || 0,
        center: map.getCenter(),
      };
    });
    expect(terrain.terrain).toEqual({ source: 'terrainSource', exaggeration: 1.43 });
    expect(terrain.source).toMatchObject({ type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
    expect(terrain.hillshade).toBeTruthy();
    expect(terrain.grid400).toBeGreaterThan(0);
    expect(terrain.grid154).toBeGreaterThan(0);
    expect(Math.abs(terrain.center.lat - 37)).toBeLessThan(0.01);
    expect(Math.abs(terrain.center.lng - 32)).toBeLessThan(0.01);

    const mapIndex = await page.evaluate(() => window.__terrainMaps.length - 1);
    await page.selectOption('#languageSelector', 'en');
    await expect(page.locator('#terrain3dToggle')).toContainText('Hide 3D');
    expect(await page.evaluate(() => window.__terrainMaps.length - 1)).toBe(mapIndex);
    expect(requests.getDemRequests()).toBe(1);

    const movedCamera = await page.evaluate(() => {
      const map = window.__terrainMaps.at(-1);
      const center = map.getCenter();
      const next = { lat: center.lat, lng: center.lng - 0.1, zoom: 8 };
      const leaflet = window.AtmoApp.app.map.map;
      const originalSetView = leaflet.setView;
      leaflet.setView = function (...args) {
        window.__terrainLeafletSetView = { center: args[0], zoom: args[1] };
        return originalSetView.apply(this, args);
      };
      map.jumpTo({ center: [next.lng, next.lat], zoom: next.zoom });
      return next;
    });
    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'false');
    const leafletCamera = await page.evaluate(() => {
      const center = window.AtmoApp.app.map.map.getCenter();
      return {
        center: { lat: center.lat, lng: center.lng, zoom: window.AtmoApp.app.map.map.getZoom() },
        applied: window.__terrainLeafletSetView,
      };
    });
    expect(leafletCamera.applied).toMatchObject({ center: [movedCamera.lat, movedCamera.lng], zoom: movedCamera.zoom });
    expect(Math.abs(leafletCamera.center.lat - 37)).toBeLessThan(1);
    expect(Math.abs(leafletCamera.center.lng - 32)).toBeLessThan(1);

    for (let count = 0; count < 5; count += 1) {
      await page.locator('#terrain3dToggle').click();
      await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#terrain3dToggle').click();
      await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'false');
    }
    expect(await page.evaluate(() => ({
      activeCanvases: document.querySelectorAll('#map3d canvas').length,
      allMapsRemoved: window.__terrainMaps.every((map) => map.removed),
      leafletVisible: !document.getElementById('map').classList.contains('terrain2dHidden'),
    }))).toEqual({ activeCanvases: 0, allMapsRemoved: true, leafletVisible: true });
  });

  test('keeps the active 3D instance coherent through TR, ES, and FR country changes', async ({ page }) => {
    await installMapLibreMock(page);
    await boot(page);
    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'true');
    const mapCount = await page.evaluate(() => window.__terrainMaps.length);

    for (const country of ['ES', 'FR']) {
      await page.selectOption('#countrySelector', country);
      await page.waitForFunction((expected) => window.AtmoApp.CONFIG.activeCountryCode === expected, country, { timeout: 30000 });
      await page.waitForFunction((expected) => {
        const map = window.__terrainMaps.at(-1);
        return map?.getSource('country-boundary')?.data?.features?.[0]?.properties?.countryCode === expected;
      }, country, { timeout: 30000 });
      expect(await page.locator('#terrain3dToggle').getAttribute('aria-pressed')).toBe('true');
    }
    expect(await page.evaluate(() => window.__terrainMaps.length)).toBe(mapCount);
  });

  test('mirrors only the Leaflet-validated MTG Fire frame into 3D', async ({ page }) => {
    await page.route('**/geoserver/wms**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await installMapLibreMock(page);
    await boot(page);
    await page.evaluate(() => window.AtmoApp.app.map.setSatelliteImagery('fire', new Date('2026-08-08T18:40:00Z')));
    await page.waitForFunction(() => {
      const manager = window.AtmoApp.app.map;
      return manager.satelliteImageryLayer?.options?.layers === window.AtmoApp.CONFIG.mtgFireTemperatureWms.layer && Boolean(manager.imageryDisplayedTime);
    }, { timeout: 10000 });
    const displayedTime = await page.evaluate(() => window.AtmoApp.app.map.imageryDisplayedTime);
    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'true');
    const mirrored = await page.evaluate(() => {
      const map = window.__terrainMaps.at(-1);
      return {
        tiles: map.getSource('operational-imagery')?.tiles || [],
        grid154: map.getLayer('grid-154-line')?.paint?.['line-color'],
      };
    });
    expect(mirrored.tiles.join('')).toContain('rgb_firetemperature');
    expect(mirrored.tiles.join('')).toContain(encodeURIComponent(displayedTime));
    expect(mirrored.grid154).toBe('#ffffff');

    await page.evaluate(() => window.AtmoApp.app.map.setSatelliteImagery('none'));
    await page.waitForFunction(() => !window.__terrainMaps.at(-1).getSource('operational-imagery'));
  });

  test('falls back to Leaflet with a localized toast when WebGL support is unavailable', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMapLibreMock(page, { unavailable: true });
    await boot(page);
    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.toast.error')).toContainText('3D arazi');
    expect(await page.locator('#map').evaluate((el) => !el.classList.contains('terrain2dHidden'))).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test('falls back to Leaflet when the Terrarium source fails', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const requests = await installMapLibreMock(page, { demFailure: true });
    await boot(page);
    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('.toast.error')).toContainText('Arazi yükseklik');
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'false');
    expect(requests.getDemRequests()).toBeGreaterThan(0);
    expect(await page.locator('#map').evaluate((el) => !el.classList.contains('terrain2dHidden'))).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test('keeps a running 3D map open after one recoverable DEM tile error', async ({ page }) => {
    await installMapLibreMock(page);
    await boot(page);
    await page.locator('#terrain3dToggle').click();
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.__terrainMaps.at(-1).emit('error', { sourceId: 'terrainSource' }));
    await page.waitForTimeout(100);
    await expect(page.locator('#terrain3dToggle')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('#map3d').evaluate((el) => !el.classList.contains('hidden'))).toBe(true);
  });
});
