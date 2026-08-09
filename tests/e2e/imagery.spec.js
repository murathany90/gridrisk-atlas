import { test, expect } from '@playwright/test';

test.describe('Satellite Imagery Lifecycle', () => {
  test.beforeEach(async ({ page }) => { 
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      if (window.caches) caches.keys().then(names => names.forEach(n => caches.delete(n)));
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
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
         urls.push(url);
      };

      if (mgr.satelliteImageryLayer) {
        addLayerUrl(mgr.satelliteImageryLayer);
        opacity = mgr.satelliteImageryLayer.options.opacity;
      }
      if (mgr.staleImageryLayer) {
        addLayerUrl(mgr.staleImageryLayer);
      }

      return { count, urls, url: urls[0] || '', opacity, storedOpacity: localStorage.getItem("satelliteImageryOpacity") };
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
    
    await page.waitForTimeout(100);
    let layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(2);
    expect(layers.urls.some(u => u.includes('rgb_geocolour'))).toBe(true);
    expect(layers.urls.some(u => u.includes('rgb_firetemperature'))).toBe(true);

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
    let tileTime = null;
    let probeTime = null;
    
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));
      const time = u.searchParams.get("TIME") || u.searchParams.get("time");
      if (width === 64) {
        probes++;
        probeTime = time;
      } else {
        fullTiles++;
        tileTime = time;
      }
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await expect(async () => {
      expect(fullTiles).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
    
    expect(probes).toBeGreaterThan(0);
    expect(tileTime).toBe(probeTime);
  });

  test('Cache background upgrade test', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-08T19:10:00Z') });

    const cachedTime = '2026-08-08T18:40:00.000Z';
    const upgradeTime = '2026-08-08T18:50:00.000Z';
    
    await page.evaluate((cTime) => {
      sessionStorage.setItem('mtgFrameCache_mtg_fd:rgb_geocolour', JSON.stringify({ time: cTime, savedAt: Date.now() }));
    }, cachedTime);

    let initialTileTime = null;
    
    await page.route(/view\.eumetsat\.int\/geoserver\/wms/i, route => {
      const u = new URL(route.request().url());
      const t = u.searchParams.get('time') || u.searchParams.get('TIME');
      const width = Number(u.searchParams.get("WIDTH") || u.searchParams.get("width"));
      
      console.log(`TEST INTERCEPT: width=${width} time=${t}`);

      if (width > 64 && !initialTileTime) initialTileTime = t;

      if (t === upgradeTime || t === cachedTime) {
         route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
      } else {
         route.fulfill({ status: 200, contentType: 'application/vnd.ogc.se_xml', body: Buffer.from('<ServiceExceptionReport></ServiceExceptionReport>') });
      }
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await expect(async () => {
      const activeIso = await page.evaluate(() => {
        const l = window.AtmoApp?.app?.map?.satelliteImageryLayer;
        return l?.wmsParams?.time || l?.options?.time;
      });
      console.log(`TEST EVAL: activeIso=${activeIso}`);
      expect(activeIso).toBe(upgradeTime);
    }).toPass({ timeout: 5000 });
    
    expect(initialTileTime).toBe(cachedTime);

    const finalCache = await page.evaluate(() => {
       try { return JSON.parse(sessionStorage.getItem('mtgFrameCache_mtg_fd:rgb_geocolour')).time; } catch(e) { return null; }
    });
    expect(finalCache).toBe(upgradeTime);
  });

});
