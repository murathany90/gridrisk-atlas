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
});
