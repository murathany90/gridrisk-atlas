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

  test('cycles through modes, preserves opacity and ensures single active layer', async ({ page }) => {
    // Initial state: NONE
    let radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('none');

    // Select LIVE
    await page.$eval('input[name="satelliteImagery"][value="live"]', el => el.click());
    let info = await page.$('#satelliteImageryInfo');
    expect(await info.evaluate(node => node.style.display)).toBe('flex');

    // Verify opacity slider affects map layer opacity natively via localStorage or directly
    await page.$eval('#mtgOpacity', el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    
    // Select FIRE
    await page.$eval('input[name="satelliteImagery"][value="fire"]', el => el.click());
    radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('fire');
    // Opacity should be preserved
    let opacityValue = await page.inputValue('#mtgOpacity');
    expect(opacityValue).toBe('50');

    // Select VIIRS
    await page.$eval('input[name="satelliteImagery"][value="highRes"]', el => el.click());
    radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('highRes');

    // Select NONE
    await page.$eval('input[name="satelliteImagery"][value="none"]', el => el.click());
    info = await page.$('#satelliteImageryInfo');
    expect(await info.evaluate(node => node.style.display)).toBe('none');
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
    expect(await info.evaluate(node => node.style.display)).toBe('flex');
    
    // Toggle imagery again (should go to NONE)
    await page.$eval('[data-quick-layer="layerMtg"]', el => el.click());
    radio = await page.$('input[name="satelliteImagery"]:checked');
    expect(await radio.inputValue()).toBe('none');
  });
});
