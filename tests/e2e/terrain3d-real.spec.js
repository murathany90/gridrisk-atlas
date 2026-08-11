import { test, expect } from '@playwright/test';
import { inflateSync } from 'node:zlib';

const valley = [30.68, 36.88];
const mountain = [30.92, 37.1];

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}

function pngCentralPixelStats(png) {
  const signature = '89504e470d0a1a0a';
  expect(png.subarray(0, 8).toString('hex')).toBe(signature);

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      channels = { 0: 1, 2: 3, 6: 4 }[data[9]] || 0;
      expect(channels).toBeGreaterThan(0);
      expect(data[12]).toBe(0);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }

  const rowBytes = width * channels;
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(rowBytes * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[source++];
    const rowStart = y * rowBytes;
    const priorStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = filtered[source++];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const above = y > 0 ? pixels[priorStart + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[priorStart + x - channels] : 0;
      pixels[rowStart + x] = filter === 0 ? value
        : filter === 1 ? (value + left) & 255
          : filter === 2 ? (value + above) & 255
            : filter === 3 ? (value + Math.floor((left + above) / 2)) & 255
              : filter === 4 ? (value + paeth(left, above, upperLeft)) & 255
                : (() => { throw new Error(`Unsupported PNG filter ${filter}`); })();
    }
  }

  const x0 = Math.floor(width * 0.1);
  const x1 = Math.floor(width * 0.72);
  const y0 = Math.floor(height * 0.1);
  const y1 = Math.floor(height * 0.72);
  const colours = new Map();
  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * channels;
      const red = pixels[index];
      const green = pixels[index + (channels > 1 ? 1 : 0)];
      const blue = pixels[index + (channels > 1 ? 2 : 0)];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const key = (red << 16) | (green << 8) | blue;
      colours.set(key, (colours.get(key) || 0) + 1);
      count += 1;
      sum += luminance;
      sumSquares += luminance * luminance;
    }
  }
  let dominantCount = 0;
  for (const colourCount of colours.values()) dominantCount = Math.max(dominantCount, colourCount);
  return {
    meanLuminance: sum / count,
    variance: sumSquares / count - (sum / count) ** 2,
    dominantColourRatio: dominantCount / count,
  };
}

test.describe('@real-terrain MapLibre and AWS Terrarium acceptance', () => {
  test('loads the pinned ESM renderer, real DEM tiles, and non-flat terrain', async ({ page }) => {
    test.setTimeout(90000);
    const pageErrors = [];
    const requests = { module: 0, css: 0, dem: 0, demPng: 0, base: 0, baseImage: 0 };
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('maplibre-gl@6.2.0/dist/maplibre-gl.mjs')) requests.module += 1;
      if (url.includes('maplibre-gl@6.2.0/dist/maplibre-gl.css')) requests.css += 1;
      if (url.includes('s3.amazonaws.com/elevation-tiles-prod/terrarium/')) requests.dem += 1;
      if (url.includes('server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/') || url.includes('tile.openstreetmap.org/')) requests.base += 1;
    });
    page.on('response', (response) => {
      if (response.url().includes('s3.amazonaws.com/elevation-tiles-prod/terrarium/') && response.status() === 200 && response.headers()['content-type']?.includes('image/png')) {
        requests.demPng += 1;
      }
      if (
        (response.url().includes('server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/') || response.url().includes('tile.openstreetmap.org/')) &&
        response.status() === 200 &&
        /^image\/(png|jpe?g)/i.test(response.headers()['content-type'] || '')
      ) requests.baseImage += 1;
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.setViewportSize({ width: 1880, height: 850 });
    await page.goto('/?country=TR&lang=tr');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.AtmoApp?.app?.map?.map));
    await expect(page.locator('#maplibre-gl-css')).toHaveCount(0);
    expect(requests).toMatchObject({ module: 0, css: 0, dem: 0 });

    await page.evaluate(([lng, lat]) => window.AtmoApp.app.map.setView(lat, lng, 10), [30.81, 37.0]);
    await page.locator('#terrain3dToggle').click();

    await expect.poll(() => page.evaluate(() => {
      const manager = window.AtmoApp?.app?.map?.terrain3d;
      const map = manager?.map;
      const source = map?.getStyle?.()?.sources?.terrainSource;
      const baseSource = map?.getStyle?.()?.sources?.['base-raster'];
      const canvas = document.querySelector('#map3d canvas.maplibregl-canvas');
      return {
        enabled: manager?.enabled,
        firstVisualReady: manager?.firstVisualReady,
        realMap: Boolean(map && window.maplibregl?.Map && map instanceof window.maplibregl.Map),
        terrain: map?.getTerrain?.(),
        source,
        baseSource,
        baseLoaded: map?.isSourceLoaded?.('base-raster'),
        hillshade: Boolean(map?.getLayer?.('terrain-hillshade')),
        canvas: Boolean(canvas && getComputedStyle(canvas).visibility !== 'hidden' && canvas.getBoundingClientRect().width > 0),
      };
    }), { timeout: 45000 }).toMatchObject({
      enabled: true,
      firstVisualReady: true,
      realMap: true,
      terrain: { source: 'terrainSource', exaggeration: 1.43 },
      source: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15 },
      baseSource: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
      baseLoaded: true,
      hillshade: true,
      canvas: true,
    });

    await expect(page.locator('#maplibre-gl-css')).toHaveCount(1);
    const geometry = await page.evaluate(() => {
      const rect = (element) => {
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const workspace = document.querySelector('.mapWorkspace');
      const map3d = document.getElementById('map3d');
      const canvas = document.querySelector('#map3d canvas.maplibregl-canvas');
      const workspaceRect = rect(workspace);
      const map3dRect = rect(map3d);
      const canvasRect = rect(canvas);
      const overlapWidth = Math.max(0, Math.min(canvasRect.right, workspaceRect.right) - Math.max(canvasRect.left, workspaceRect.left));
      const overlapHeight = Math.max(0, Math.min(canvasRect.bottom, workspaceRect.bottom) - Math.max(canvasRect.top, workspaceRect.top));
      return {
        position: getComputedStyle(map3d).position,
        workspace: workspaceRect,
        map3d: map3dRect,
        canvas: canvasRect,
        canvasWorkspaceRatio: (overlapWidth * overlapHeight) / (canvasRect.width * canvasRect.height),
        scrollHeight: workspace.scrollHeight,
        clientHeight: workspace.clientHeight,
        mapLibreCssLoaded: Boolean(document.getElementById('maplibre-gl-css')?.sheet),
        mapLibreAfterAppCss: [...document.head.children].indexOf(document.getElementById('maplibre-gl-css')) > [...document.head.children].findIndex((node) => node.tagName === 'LINK' && node.href.includes('css/styles.css')),
        mapLibreClass: map3d.classList.contains('maplibregl-map'),
        leafletHidden: document.getElementById('map').classList.contains('terrain2dHidden'),
      };
    });
    expect(geometry).toMatchObject({
      position: 'absolute',
      mapLibreCssLoaded: true,
      mapLibreAfterAppCss: true,
      mapLibreClass: true,
      leafletHidden: true,
    });
    expect(Math.abs(geometry.map3d.left - geometry.workspace.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.map3d.top - geometry.workspace.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.map3d.width - geometry.workspace.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.map3d.height - geometry.workspace.height)).toBeLessThanOrEqual(2);
    expect(geometry.canvas.left).toBeGreaterThanOrEqual(geometry.workspace.left);
    expect(geometry.canvas.top).toBeGreaterThanOrEqual(geometry.workspace.top);
    expect(geometry.canvas.right).toBeLessThanOrEqual(geometry.workspace.right + 2);
    expect(geometry.canvas.bottom).toBeLessThanOrEqual(geometry.workspace.bottom + 2);
    expect(geometry.canvasWorkspaceRatio).toBeGreaterThanOrEqual(0.95);
    expect(geometry.scrollHeight - geometry.clientHeight).toBeLessThanOrEqual(2);
    await expect(page.locator('#map3d')).toBeInViewport({ ratio: 0.95 });
    await expect(page.locator('#map3d canvas.maplibregl-canvas')).toBeInViewport({ ratio: 0.95 });

    await expect.poll(() => requests.demPng, { timeout: 45000 }).toBeGreaterThan(0);
    await expect.poll(() => requests.baseImage, { timeout: 45000 }).toBeGreaterThan(0);
    let elevations = { valleyElevation: null, mountainElevation: null };
    await expect.poll(async () => {
      elevations = await page.evaluate(([valleyPoint, mountainPoint]) => {
        const map = window.AtmoApp.app.map.terrain3d.map;
        return {
          valleyElevation: map?.queryTerrainElevation?.(valleyPoint),
          mountainElevation: map?.queryTerrainElevation?.(mountainPoint),
        };
      }, [valley, mountain]);
      return Number.isFinite(elevations.valleyElevation) &&
        Number.isFinite(elevations.mountainElevation) &&
        Math.abs(elevations.valleyElevation) > 1 &&
        Math.abs(elevations.mountainElevation - elevations.valleyElevation) > 20;
    }, { timeout: 45000 }).toBe(true);
    expect(Math.abs(elevations.valleyElevation)).toBeGreaterThan(1);
    expect(Math.abs(elevations.mountainElevation - elevations.valleyElevation)).toBeGreaterThan(20);
    expect(requests).toMatchObject({ module: 1, css: 1 });
    expect(requests.dem).toBeGreaterThan(0);
    expect(requests.base).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    const workspaceBox = await page.locator('.mapWorkspace').boundingBox();
    expect(workspaceBox).not.toBeNull();
    const terrainScreenshot = await page.screenshot({ clip: workspaceBox });
    const visual = pngCentralPixelStats(terrainScreenshot);
    expect(visual.variance).toBeGreaterThan(120);
    expect(visual.dominantColourRatio).toBeLessThan(0.85);
  });
});
