import { test, expect } from '@playwright/test';

test.describe('Satellite Imagery Lifecycle', () => {
  test.beforeEach(async ({ page }) => { 
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      if (window.caches) caches.keys().then(names => names.forEach(n => caches.delete(n)));
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    });
    await page.goto('/?country=TR&lang=tr');
    await page.waitForSelector('.leaflet-container');
    await page.$eval('[data-i18n="layers.title"]', el => el.click());
  });

  async function getImageryLayerInfo(page) {
    return await page.evaluate(() => {
      let count = 0;
      let urls = [];
      let opacity = -1;
      const mgr = window.AtmoApp?.app?.map;
      if (!mgr || !mgr.map) return { count, urls, opacity, storedOpacity: null };

      mgr.map.eachLayer(l => {
        if (l.options && l.options.pane === "imageryPane") count++;
      });

      const addLayerUrl = (l) => {
         if (!l) return;
         let url = l._url || '';
         if (l.options && l.options.layers) url += ' (layers: ' + l.options.layers + ')';
         if (l.options && l.options.layer) url += ' (layer: ' + l.options.layer + ')';
         if (!urls.includes(url)) urls.push(url);
      };

      if (mgr.satelliteImageryLayer) {
        addLayerUrl(mgr.satelliteImageryLayer);
        opacity = mgr.satelliteImageryLayer.options.opacity;
      }
      if (mgr.staleImageryLayer) {
        addLayerUrl(mgr.staleImageryLayer);
      }
      if (mgr.pendingImageryLayer) {
        addLayerUrl(mgr.pendingImageryLayer);
      }

      return {
        count,
        urls,
        url: urls[0] || '',
        opacity,
        activeTime: mgr.satelliteImageryLayer?.wmsParams?.time || mgr.satelliteImageryLayer?.options?.time || null,
        displayedTime: mgr.imageryDisplayedTime,
        pendingTime: mgr.pendingImageryLayer?.wmsParams?.time || mgr.pendingImageryLayer?.options?.time || null,
        storedOpacity: localStorage.getItem("satelliteImageryOpacity"),
      };
    });
  }

  test('cycles through modes, preserves opacity and ensures single active layer', async ({ page }) => {
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await page.route('**/VIIRS_NOAA21_CorrectedReflectance_TrueColor**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));

    let radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('none');

    let layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(0);

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('rgb_geocolour');
    }).toPass({ timeout: 5000 });

    await page.$eval('#mtgOpacity', el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(100);

    layers = await getImageryLayerInfo(page);
    expect(layers.opacity).toBe(0);
    expect(layers.storedOpacity).toBe("0");

    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.url).toContain('rgb_firetemperature');
      expect(layers.count).toBe(1);
    }).toPass();
    expect(layers.opacity).toBe(0);

    await page.$eval('input[name="satelliteImagery"][value="highRes"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.urls.some(u => u.includes('VIIRS_NOAA21'))).toBe(true);
    }).toPass();

    await page.$eval('input[name="satelliteImagery"][value="none"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(0);
    }).toPass();
  });

  test('mobile quick layers synchronizes with desktop radios', async ({ page }) => {
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await page.setViewportSize({ width: 375, height: 667 });
    await page.$eval('#quickLayersFab', el => el.click());
    await page.$eval('[data-quick-layer="layerMtg"]', el => el.click());
    
    await expect(async () => {
      let radio = await page.$('input[name="satelliteImagery"]:checked');
      expect(await radio.inputValue()).toBe('live');
    }).toPass();

    await page.$eval('[data-quick-layer="layerMtg"]', el => el.click());
    await expect(async () => {
      let radio = await page.$('input[name="satelliteImagery"]:checked');
      expect(await radio.inputValue()).toBe('none');
    }).toPass();
  });

  test('GeoColour vs Fire probes request distinct layers', async ({ page }) => {
    let liveRequested = false;
    let fireRequested = false;

    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const layer = u.searchParams.get("LAYERS") || u.searchParams.get("layers");
      if (layer === 'mtg_fd:rgb_geocolour') liveRequested = true;
      if (layer === 'mtg_fd:rgb_firetemperature') fireRequested = true;
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => expect(liveRequested).toBe(true)).toPass({ timeout: 5000 });
    
    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => expect(fireRequested).toBe(true)).toPass({ timeout: 5000 });
  });

  test('Fast mode switching prevents async race conditions', async ({ page }) => {
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, async route => {
      const u = new URL(route.request().url());
      const layer = u.searchParams.get("LAYERS") || u.searchParams.get("layers");
      if (layer === 'mtg_fd:rgb_geocolour') await new Promise(r => setTimeout(r, 1500));
      if (layer === 'mtg_fd:rgb_firetemperature') await new Promise(r => setTimeout(r, 1000));
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('**/VIIRS_NOAA21_CorrectedReflectance_TrueColor**', route => {
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(50);
    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(50);
    await page.$eval('input[name="satelliteImagery"][value="highRes"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await page.waitForTimeout(1700);
      
    await expect(async () => {
      const layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('VIIRS_NOAA21');
      const legendText = await page.evaluate(() => document.querySelector('[data-legend="satelliteImagery"] .sourceNote')?.textContent || '');
      expect(legendText).toContain('NOAA-21');
    }).toPass({ timeout: 5000 });
  });

  test('Stale-while-revalidate keeps old layer until new one loads', async ({ page }) => {
    let resolveFireRoute; const fireRoutePromise = new Promise(r => resolveFireRoute = r);
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, async route => {
      const u = new URL(route.request().url());
      const layer = u.searchParams.get("LAYERS") || u.searchParams.get("layers");
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));
      if (layer === 'mtg_fd:rgb_firetemperature' && width > 64) await fireRoutePromise;
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      const layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('rgb_geocolour');
    }).toPass({ timeout: 5000 });

    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    let layers;
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(2);
      expect(layers.urls.some(u => u.includes('rgb_geocolour'))).toBe(true);
      expect(layers.urls.some(u => u.includes('rgb_firetemperature'))).toBe(true);
    }).toPass({ timeout: 5000 });

    resolveFireRoute();

    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('rgb_firetemperature');
    }).toPass({ timeout: 5000 });
  });

  test('satellite imagery layer is non-interactive', async ({ page }) => {
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      const hasClass = await page.evaluate(() => !!document.querySelector('.satellite-imagery-layer'));
      expect(hasClass).toBe(true);
    }).toPass({ timeout: 5000 });

    const cssOptions = await page.evaluate(() => {
      const layer = document.querySelector('.satellite-imagery-layer');
      return { pointerEvents: getComputedStyle(layer).pointerEvents };
    });
    expect(cssOptions.pointerEvents).toBe('none');
  });

  test('Language switch does not recreate MTG layer or probe', async ({ page }) => {
    let probeCount = 0;
    let fullTileCount = 0;
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));
      if (width === 64) probeCount++;
      else fullTileCount++;
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      const layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
    }).toPass({ timeout: 5000 });

    // Let the expected latest-mode freshness pass settle before measuring the
    // language action itself.  The action must add exactly zero requests.
    await page.waitForFunction(() => {
      const map = window.AtmoApp?.app?.map;
      const mgr = map?._mtgFrameMgr;
      const active = map?.satelliteImageryLayer;
      const slot = (window.AtmoApp.CONFIG.mtgGeoColourWms.slotMinutes || 10) * 60 * 1000;
      const latest = new Date(Math.floor(Date.now() / slot) * slot).toISOString();
      return Boolean(
        mgr &&
        mgr._backgroundTimer === null &&
        mgr._probeAbort === null &&
        !map.pendingImageryLayer &&
        active?.options?.time === latest,
      );
    }, { timeout: 5000 });
    
    const initialProbeCount = probeCount;
    const initialTileCount = fullTileCount;
    const initialLayerInst = await page.evaluate(() => window.AtmoApp?.app?.map?.satelliteImageryLayer?._leaflet_id);
    const initialTime = await page.evaluate(() => window.AtmoApp?.app?.map?.satelliteImageryLayer?.options?.time);

    await page.selectOption('#languageSelector', 'en');
    await page.waitForTimeout(500);

    const finalLayerInst = await page.evaluate(() => window.AtmoApp?.app?.map?.satelliteImageryLayer?._leaflet_id);
    const finalTime = await page.evaluate(() => window.AtmoApp?.app?.map?.satelliteImageryLayer?.options?.time);

    expect(probeCount).toBe(initialProbeCount);
    expect(fullTileCount).toBe(initialTileCount);
    expect(finalLayerInst).toBe(initialLayerInst);
    expect(finalTime).toBe(initialTime);
  });

  test('Probe-first ensures invalid time prevents full WMS tiles', async ({ page }) => {
    let probes = 0; 
    let fullTiles = 0;
    
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));
      if (width === 64) probes++;
      else fullTiles++;
      
      route.fulfill({ status: 200, contentType: 'application/vnd.ogc.se_xml', body: Buffer.from('<ServiceExceptionReport></ServiceExceptionReport>') });
    });
    
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await expect(async () => { expect(probes).toBeGreaterThan(0); }).toPass({ timeout: 5000 }); 
    expect(fullTiles).toBe(0);
  });

  test('Valid probe creates full WMS layer', async ({ page }) => {
    let probes = 0;
    let fullTiles = 0;
    const tileTimes = [];
    const probeTimes = [];
    
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));
      const time = u.searchParams.get("TIME") || u.searchParams.get("time");
      if (width === 64) {
        probes++;
        probeTimes.push(time);
      } else {
        fullTiles++;
        tileTimes.push(time);
      }
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await expect(async () => {
      expect(fullTiles).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
    
    expect(probes).toBeGreaterThan(0);
    for (const time of tileTimes) expect(probeTimes).toContain(time);
  });

  test('an invalid current slot backfills before creating full tiles', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-08T19:10:00Z') });
    const invalidTime = '2026-08-08T18:50:00.000Z';
    const validTime = '2026-08-08T18:40:00.000Z';
    const probes = [];
    const tiles = [];

    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get('WIDTH') || u.searchParams.get('width'));
      const time = u.searchParams.get('TIME') || u.searchParams.get('time');
      if (width === 64) probes.push(time);
      else tiles.push(time);
      route.fulfill(
        time === validTime
          ? { status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }
          : { status: 200, contentType: 'application/vnd.ogc.se_xml', body: Buffer.from('<ServiceExceptionReport/>') },
      );
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(() => tiles.length).toBeGreaterThan(0);
    expect(probes).toContain(invalidTime);
    expect(probes).toContain(validTime);
    expect(tiles).toEqual(expect.arrayContaining([validTime]));
    expect(tiles).not.toContain(invalidTime);
  });

  test('historical MTG display preserves the latest cache and returns to its cached frame', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-08T19:10:00Z') });
    const cachedTime = '2026-08-08T18:40:00.000Z';
    const historicalTime = '2026-08-08T13:10:00.000Z';
    const nowTime = '2026-08-08T19:10:00.000Z';
    let probes = 0;
    const tiles = [];

    await page.evaluate(time => {
      sessionStorage.setItem('mtgFrameCache_mtg_fd:rgb_geocolour', JSON.stringify({ time, savedAt: Date.now() }));
    }, cachedTime);
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get('WIDTH') || u.searchParams.get('width'));
      const time = u.searchParams.get('TIME') || u.searchParams.get('time');
      if (width === 64) probes++;
      else tiles.push(time);
      route.fulfill(
        time === historicalTime || time === cachedTime
          ? { status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }
          : { status: 200, contentType: 'application/vnd.ogc.se_xml', body: Buffer.from('<ServiceExceptionReport/>') },
      );
    });

    await page.evaluate(time => {
      window.AtmoApp.app.map.setSatelliteImagery('live', new Date(time));
    }, historicalTime);
    await expect.poll(() => tiles.length).toBeGreaterThan(0);
    expect(tiles).toEqual(expect.arrayContaining([historicalTime]));
    expect(tiles).not.toContain(cachedTime);
    expect(probes).toBe(1);

    await page.clock.fastForward(7000);
    expect(probes).toBe(1);
    expect((await getImageryLayerInfo(page)).displayedTime).toBe(historicalTime);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('mtgFrameCache_mtg_fd:rgb_geocolour'))?.time ?? null)).toBe(cachedTime);

    tiles.length = 0;
    await page.evaluate(time => {
      window.AtmoApp.app.map.setSatelliteImagery('live', new Date(time));
    }, nowTime);
    await expect.poll(() => tiles.length).toBeGreaterThan(0);
    expect(tiles[0]).toBe(cachedTime);
    expect(tiles).not.toContain(historicalTime);
  });

  test('a valid latest probe with a failed full WMS tile does not replace the cache', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-08T19:10:00Z') });
    const cachedTime = '2026-08-08T18:40:00.000Z';
    const failedTime = '2026-08-08T18:50:00.000Z';
    const probeTimes = [];
    const failedTileTimes = [];

    await page.evaluate(time => {
      sessionStorage.setItem('mtgFrameCache_mtg_fd:rgb_geocolour', JSON.stringify({ time, savedAt: Date.now() }));
    }, cachedTime);
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get('WIDTH') || u.searchParams.get('width'));
      const time = u.searchParams.get('TIME') || u.searchParams.get('time');
      if (width === 64) probeTimes.push(time);
      if (width > 64 && time === failedTime) {
        failedTileTimes.push(time);
        route.fulfill({ status: 500, contentType: 'text/plain', body: 'tile failure' });
        return;
      }
      route.fulfill(
        time === cachedTime || (width === 64 && time === failedTime)
          ? { status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }
          : { status: 200, contentType: 'application/vnd.ogc.se_xml', body: Buffer.from('<ServiceExceptionReport/>') },
      );
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(async () => {
      expect((await getImageryLayerInfo(page)).activeTime).toBe(cachedTime);
    }).toPass({ timeout: 5000 });

    await page.clock.fastForward(300);
    await expect(async () => {
      expect(probeTimes).toContain(failedTime);
      expect(failedTileTimes).toContain(failedTime);
      expect((await getImageryLayerInfo(page)).pendingTime).toBeNull();
    }).toPass({ timeout: 5000 });
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('mtgFrameCache_mtg_fd:rgb_geocolour'))?.time ?? null)).toBe(cachedTime);

    await page.reload();
    await page.waitForSelector('.leaflet-container');
    probeTimes.length = 0;
    failedTileTimes.length = 0;
    expect(await page.evaluate(() => sessionStorage.getItem('mtgFrameCache_mtg_fd:rgb_geocolour'))).toBeNull();

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(async () => {
      expect(probeTimes).toContain(failedTime);
      expect(failedTileTimes).toContain(failedTime);
    }).toPass({ timeout: 5000 });
    expect(await page.evaluate(() => sessionStorage.getItem('mtgFrameCache_mtg_fd:rgb_geocolour'))).toBeNull();
  });

  test('cached latest frame paints first, then promotes only after the fresher layer loads', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-08T19:10:00Z') });

    const cachedTime = '2026-08-08T18:40:00.000Z';
    const upgradeTime = '2026-08-08T19:00:00.000Z';
    
    await page.evaluate((cTime) => {
      sessionStorage.setItem('mtgFrameCache_mtg_fd:rgb_geocolour', JSON.stringify({ time: cTime, savedAt: Date.now() }));
    }, cachedTime);

    let initialTileTime = null;
    const probeTimes = [];
    let resolveUpgradeTile;
    const waitForUpgradeTile = new Promise(resolve => { resolveUpgradeTile = resolve; });
    
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, async route => {
      const u = new URL(route.request().url());
      const t = u.searchParams.get('time') || u.searchParams.get('TIME');
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));

      if (width === 64) probeTimes.push(t);
      if (width > 64 && !initialTileTime) initialTileTime = t;
      if (width > 64 && t === upgradeTime) await waitForUpgradeTile;
      if (t === upgradeTime || t === cachedTime) {
         route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
      } else {
         route.fulfill({ status: 200, contentType: 'application/vnd.ogc.se_xml', body: Buffer.from('<ServiceExceptionReport></ServiceExceptionReport>') });
      }
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });

    await expect(async () => {
      expect((await getImageryLayerInfo(page)).activeTime).toBe(cachedTime);
    }).toPass({ timeout: 5000 });
    expect(initialTileTime).toBe(cachedTime);

    await page.clock.fastForward(300);
    await expect(async () => {
      const layer = await getImageryLayerInfo(page);
      expect(probeTimes).toEqual(expect.arrayContaining(['2026-08-08T19:10:00.000Z', upgradeTime]));
      expect(layer.pendingTime).toBe(upgradeTime);
      expect(layer.displayedTime).toBe(cachedTime);
      expect(layer.count).toBe(2);
    }).toPass({ timeout: 5000 });

    resolveUpgradeTile();
    await expect(async () => {
      const layer = await getImageryLayerInfo(page);
      expect(layer.activeTime).toBe(upgradeTime);
      expect(layer.displayedTime).toBe(upgradeTime);
      expect(layer.count).toBe(1);
    }).toPass({ timeout: 5000 });

    const finalCache = await page.evaluate(() => {
       try { return JSON.parse(sessionStorage.getItem('mtgFrameCache_mtg_fd:rgb_geocolour')).time; } catch(e) { return null; }
    });
    expect(finalCache).toBe(upgradeTime);
  });

});
