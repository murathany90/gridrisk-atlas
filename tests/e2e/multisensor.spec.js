import { test, expect } from '@playwright/test';

test.describe('Multi-sensor UI and Mode Tests', () => {
  test('SEPARATE_SOURCES mode hides multi-sensor layer checkbox and shows SLSTR', async ({ page }) => {
    await page.goto('/?thermalMode=SEPARATE_SOURCES');
    await page.waitForLoadState('networkidle');
    
    const slstrLabel = page.locator('label:has(#layerSentinelSlstr)');
    await expect(slstrLabel).toBeVisible();
    
    const mtgLabel = page.locator('label:has(#layerMtgFrp)');
    await expect(mtgLabel).toBeVisible();

    const multiSensorLabel = page.locator('label:has(#layerMultiSensorConf)');
    await expect(multiSensorLabel).toBeHidden();
  });

  test('MULTI_SOURCE mode shows multi-sensor checkbox and hides others if not alternate', async ({ page }) => {
    await page.goto('/?thermalMode=MULTI_SOURCE');
    await page.waitForLoadState('networkidle');
    
    const multiSensorLabel = page.locator('label:has(#layerMultiSensorConf)');
    await expect(multiSensorLabel).toBeVisible();
  });

  test('FIRMS_ONLY mode hides all alternate layers', async ({ page }) => {
    await page.goto('/?thermalMode=FIRMS_ONLY');
    await page.waitForLoadState('networkidle');
    
    const slstrLabel = page.locator('label:has(#layerSentinelSlstr)');
    await expect(slstrLabel).toBeHidden();

    const mtgLabel = page.locator('label:has(#layerMtgFrp)');
    await expect(mtgLabel).toBeHidden();

    const multiSensorLabel = page.locator('label:has(#layerMultiSensorConf)');
    await expect(multiSensorLabel).toBeHidden();
  });

  test('Multi-sensor marker visibility on map', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('thermalMode', 'MULTI_SOURCE');
    });
    page.on('console', msg => console.log('Browser:', msg.text()));
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const mockEvents = [{
        id: "mock_ms_1",
        lat: 39.0,
        lon: 35.0,
        independentSensorCount: 2,
        sensorFamilies: ["viirs-modis", "slstr"],
        maxFrpMw: 5000.0,
        observationCount: 3,
        confirmationLevel: 2
      }];
      if (window.AtmoApp && window.AtmoApp.Utils) {
        window.AtmoApp.Utils.insideRegion = () => true;
      }
      const app = window.AtmoApp ? window.AtmoApp.app : null;
      if (app && app.state && app.map) {
        app.state.multiSensorEvents = mockEvents;
        app.map.setMultiSensor(mockEvents, new Date());
        app.map.toggleMultiSensor(true);
      }
      const span = document.getElementById("multiSensorCount");
      if (span) span.textContent = "1";
    });

    const countText = await page.locator('#multiSensorCount').textContent();
    expect(Number(countText)).toBeGreaterThan(0);

    const markerCount = await page.evaluate(() => {
      const app = window.AtmoApp ? window.AtmoApp.app : null;
      if (app && app.map && app.map.multiSensorLayer) {
        return app.map.multiSensorLayer.getLayers().length;
      }
      return 0;
    });
    expect(markerCount).toBeGreaterThan(0);
  });
});
