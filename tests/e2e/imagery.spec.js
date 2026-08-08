import { test, expect } from '@playwright/test';

test.describe('Satellite Imagery Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept MTG GeoColour
    await page.route('**/mtg_fd:rgb_geocolour**', route => {
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('') });
    });
    // Intercept MTG Fire Temperature
    await page.route('**/mtg_fd:rgb_firetemperature**', route => {
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('') });
    });
    // Intercept VIIRS
    await page.route('**/VIIRS_NOAA21_CorrectedReflectance_TrueColor**', route => {
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') });
    });

    await page.goto('/?country=TR&lang=tr');
    // Ensure map is loaded
    await page.waitForSelector('.leaflet-container');
    // Open the layers panel (native click bypasses visibility errors)
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
    // Initial state: NONE
    let radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('none');

    let layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(0);

    // Select LIVE
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(200);
    let info = await page.$('#satelliteImageryInfo');
    expect(await info.evaluate(node => node.style.display)).toBe('');

    layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(1);
    expect(layers.url).toContain('mtg_fd:rgb_geocolour');

    // Verify opacity slider affects map layer opacity natively via localStorage or directly
    await page.$eval('#mtgOpacity', el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(100);

    layers = await getImageryLayerInfo(page);
    expect(layers.opacity).toBe(0);
    expect(layers.storedOpacity).toBe("0");

    // Select FIRE
    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(200);
    radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('fire');

    layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(1);
    expect(layers.url).toContain('mtg_fd:rgb_firetemperature');
    expect(layers.opacity).toBe(0);

    // Opacity should be preserved
    let opacityValue = await page.inputValue('#mtgOpacity');
    expect(opacityValue).toBe('0');

    // Select VIIRS
    await page.$eval('input[name="satelliteImagery"][value="highRes"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(200);
    radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('highRes');

    layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(1);
    expect(layers.url).toContain('VIIRS_NOAA21');
    expect(layers.opacity).toBe(0);

    // VIIRS -> LIVE
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(200);
    layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(1);
    expect(layers.url).toContain('mtg_fd:rgb_geocolour');
    expect(layers.opacity).toBe(0);

    // Select NONE
    await page.$eval('input[name="satelliteImagery"][value="none"]', el => { el.click(); el.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.waitForTimeout(200);
    info = await page.$('#satelliteImageryInfo');
    expect(await info.evaluate(node => node.style.display)).toBe('none');

    layers = await getImageryLayerInfo(page);
    expect(layers.count).toBe(0);
  });

  test('mobile quick layers synchronizes with desktop radios', async ({ page }) => {
    // Switch to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Open quick layers FAB
    await page.$eval('#quickLayersFab', el => el.click());
    // Toggle imagery via quick layer (should go to LIVE)
    await page.$eval('[data-quick-layer="layerMtg"]', el => el.click());

    // Check if the underlying radio changed to live
    let radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('live');

    // Check if the info panel became visible
    let info = await page.$('#satelliteImageryInfo');
    expect(await info.evaluate(node => node.style.display)).toBe('');

    // Toggle imagery again (should go to NONE)
    await page.$eval('[data-quick-layer="layerMtg"]', el => el.click());
    radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('none');
  });
});
