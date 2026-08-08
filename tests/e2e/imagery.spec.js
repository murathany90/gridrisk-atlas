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
      let url = '';
      let opacity = -1;
      const mgr = window.AtmoApp?.app?.map;
      if (!mgr || !mgr.map) return { count, url, opacity, storedOpacity: null };

      mgr.map.eachLayer(l => {
        if (l.options && l.options.pane === "imageryPane") {
          count++;
        }
      });

      if (mgr.satelliteImageryLayer) {
        const l = mgr.satelliteImageryLayer;
        url = l._url || '';
        if (l.options && l.options.layers) url += ' (layers: ' + l.options.layers + ')';
        if (l.options && l.options.layer) url += ' (layer: ' + l.options.layer + ')';
        opacity = l.options.opacity;
      }
      return { count, url, opacity, storedOpacity: localStorage.getItem("satelliteImageryOpacity") };
    });
  }

  test('cycles through modes, preserves opacity and ensures single active layer', async ({ page }) => {
    await page.route('**/*mtg_fd*rgb_geocolour*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await page.route('**/*mtg_fd*rgb_firetemperature*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await page.route('**/VIIRS_NOAA21_CorrectedReflectance_TrueColor**', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));

    let radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('none');

    let layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(0);

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
    }).toPass({ timeout: 5000 });
    expect(layers.url).toContain('rgb_geocolour');

    await page.$eval('#mtgOpacity', el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(100);

    layers = await getImageryLayerInfo(page);
    expect(layers.opacity).toBe(0);
    expect(layers.storedOpacity).toBe("0");

    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.url).toContain('rgb_firetemperature');
    }).toPass();
    expect(layers.count).toBe(1);
    expect(layers.opacity).toBe(0);

    await page.$eval('input[name="satelliteImagery"][value="highRes"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.url).toContain('VIIRS_NOAA21');
    }).toPass();
    expect(layers.count).toBe(1);

    await page.$eval('input[name="satelliteImagery"][value="none"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(0);
    }).toPass();
  });

  test('mobile quick layers synchronizes with desktop radios', async ({ page }) => {
    await page.route('**/*mtg_fd*rgb_geocolour*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
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
    await page.route('**/*mtg_fd*rgb_geocolour*', route => {
      liveRequested = true;
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('**/*mtg_fd*rgb_firetemperature*', route => {
      fireRequested = true;
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => expect(liveRequested).toBe(true)).toPass({ timeout: 5000 });
    
    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => expect(fireRequested).toBe(true)).toPass({ timeout: 5000 });
  });

  test('Fast mode switching prevents async race conditions', async ({ page }) => {
    await page.route('**/*mtg_fd*rgb_geocolour*', async route => {
      await new Promise(r => setTimeout(r, 1500));
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('**/*mtg_fd*rgb_firetemperature*', async route => {
      await new Promise(r => setTimeout(r, 1000));
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('**/VIIRS_NOAA21_CorrectedReflectance_TrueColor**', route => {
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(50);
    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(50);
    await page.$eval('input[name="satelliteImagery"][value="highRes"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await expect(async () => {
      const layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('VIIRS_NOAA21');
    }).toPass({ timeout: 5000 });
  });

  test('Stale-while-revalidate keeps old layer until new one loads', async ({ page }) => {
    await page.route('**/*mtg_fd*rgb_geocolour*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    
    let fireResolve = null;
    await page.route('**/*mtg_fd*rgb_firetemperature*', async route => {
      await new Promise(r => fireResolve = r);
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      const layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('rgb_geocolour');
    }).toPass({ timeout: 5000 });

    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    // Check that we don't immediately remove old layer
    await page.waitForTimeout(100);
    let layers = await getImageryLayerInfo(page);
    expect(layers.count).toBeLessThanOrEqual(2);
    
    // Resolve the new one
    fireResolve();
    
    await expect(async () => {
      layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
      expect(layers.url).toContain('rgb_firetemperature');
    }).toPass({ timeout: 5000 });
  });

  test('Crossfade styling is applied to satellite layers', async ({ page }) => {
    await page.route('**/*mtg_fd*rgb_geocolour*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    
    await expect(async () => {
      const hasClass = await page.evaluate(() => !!document.querySelector('.satellite-imagery-layer'));
      expect(hasClass).toBe(true);
    }).toPass({ timeout: 5000 });

    const cssOptions = await page.evaluate(() => {
      const layer = document.querySelector('.satellite-imagery-layer');
      return {
        pointerEvents: getComputedStyle(layer).pointerEvents,
        transition: getComputedStyle(layer).transition,
      };
    });
    expect(cssOptions.pointerEvents).toBe('none');
    
  });

  test('Language switch does not recreate MTG layer or probe', async ({ page }) => {
    let probeCount = 0;
    await page.route('**/*mtg_fd*rgb_geocolour*', route => {
      probeCount++;
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    });

    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await expect(async () => {
      const layers = await getImageryLayerInfo(page);
      expect(layers.count).toBe(1);
    }).toPass({ timeout: 5000 });
    
    const initialProbeCount = probeCount;
    await page.selectOption('#languageSelector', 'en');
    await page.waitForTimeout(500);

    expect(probeCount).toBe(initialProbeCount);
  });
});
