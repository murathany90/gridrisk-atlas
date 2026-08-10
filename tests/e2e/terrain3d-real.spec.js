import { test, expect } from '@playwright/test';

const valley = [30.68, 36.88];
const mountain = [30.92, 37.1];

test.describe('@real-terrain MapLibre and AWS Terrarium acceptance', () => {
  test('loads the pinned ESM renderer, real DEM tiles, and non-flat terrain', async ({ page }) => {
    test.setTimeout(90000);
    const pageErrors = [];
    const requests = { module: 0, css: 0, dem: 0, demPng: 0 };
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('maplibre-gl@6.2.0/dist/maplibre-gl.mjs')) requests.module += 1;
      if (url.includes('maplibre-gl@6.2.0/dist/maplibre-gl.css')) requests.css += 1;
      if (url.includes('s3.amazonaws.com/elevation-tiles-prod/terrarium/')) requests.dem += 1;
    });
    page.on('response', (response) => {
      if (response.url().includes('s3.amazonaws.com/elevation-tiles-prod/terrarium/') && response.status() === 200 && response.headers()['content-type']?.includes('image/png')) {
        requests.demPng += 1;
      }
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/?country=TR&lang=tr');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.AtmoApp?.app?.map?.map));
    expect(requests).toMatchObject({ module: 0, css: 0, dem: 0 });

    await page.evaluate(([lng, lat]) => window.AtmoApp.app.map.setView(lat, lng, 10), [30.81, 37.0]);
    const leafletscreenshot = await page.screenshot();
    expect(leafletscreenshot.length).toBeGreaterThan(1000);
    await page.locator('#terrain3dToggle').click();

    await expect.poll(() => page.evaluate(() => {
      const manager = window.AtmoApp?.app?.map?.terrain3d;
      const map = manager?.map;
      const source = map?.getStyle?.().sources?.terrainSource;
      const canvas = document.querySelector('#map3d canvas.maplibregl-canvas');
      return {
        enabled: manager?.enabled,
        realMap: Boolean(map && window.maplibregl?.Map && map instanceof window.maplibregl.Map),
        terrain: map?.getTerrain?.(),
        source,
        hillshade: Boolean(map?.getLayer?.('terrain-hillshade')),
        canvas: Boolean(canvas && getComputedStyle(canvas).visibility !== 'hidden' && canvas.getBoundingClientRect().width > 0),
      };
    }), { timeout: 45000 }).toMatchObject({
      enabled: true,
      realMap: true,
      terrain: { source: 'terrainSource', exaggeration: 1.43 },
      source: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15 },
      hillshade: true,
      canvas: true,
    });

    await expect.poll(() => requests.demPng, { timeout: 45000 }).toBeGreaterThan(0);
    let elevations = { valleyElevation: null, mountainElevation: null };
    await expect.poll(async () => {
      elevations = await page.evaluate(([valleyPoint, mountainPoint]) => {
        const map = window.AtmoApp.app.map.terrain3d.map;
        return {
          valleyElevation: map?.queryTerrainElevation?.(valleyPoint),
          mountainElevation: map?.queryTerrainElevation?.(mountainPoint),
        };
      }, [valley, mountain]);
      return Number.isFinite(elevations.valleyElevation) && Number.isFinite(elevations.mountainElevation);
    }, { timeout: 45000 }).toBe(true);
    expect(Math.abs(elevations.valleyElevation)).toBeGreaterThan(1);
    expect(Math.abs(elevations.mountainElevation - elevations.valleyElevation)).toBeGreaterThan(20);
    expect(requests).toMatchObject({ module: 1, css: 1 });
    expect(requests.dem).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    const terrainScreenshot = await page.screenshot();
    expect(terrainScreenshot.length).toBeGreaterThan(1000);
  });
});
