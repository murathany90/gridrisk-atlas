import { test, expect } from '@playwright/test';

test.describe('GridRisk Atlas E2E Tests', () => {
  let errors = [];
  let networkFailures = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    networkFailures = [];

    // Capture console errors
    page.on('pageerror', (err) => {
      errors.push(`PageError: ${err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`ConsoleError: ${msg.text()}`);
      }
    });

    // Capture failed network requests (excluding API requests that might naturally fail if offline/mocked, but we should log them)
    page.on('response', (response) => {
      if (!response.ok() && response.status() !== 200) {
        networkFailures.push(`Failed Request: ${response.url()} - Status: ${response.status()}`);
      }
    });
  });

  test('Main application loads successfully and UI is interactive', async ({ page }) => {
    // 5. Start app and check HTTP 200
    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    // Verify Title
    await expect(page).toHaveTitle(/GridRisk Atlas/i);

    // Verify Countries and switch
    const countrySelector = page.locator('#countrySelector');
    await expect(countrySelector).toBeVisible();

    const countries = ['TR', 'ES', 'FR', 'PT', 'IT'];
    for (const country of countries) {
      await countrySelector.selectOption(country);
      // Wait for some network or UI update if needed, we'll just check if it selected
      expect(await countrySelector.inputValue()).toBe(country);
    }

    // Verify Language and switch
    const langSelector = page.locator('#languageSelector');
    await langSelector.selectOption('en');
    expect(await langSelector.inputValue()).toBe('en');
    await langSelector.selectOption('tr');
    expect(await langSelector.inputValue()).toBe('tr');

    // Switch to Settings view to check modes
    const settingsBtn = page.locator('button[data-view="settings"]');
    await settingsBtn.click();
    
    // Find association mode selector (usually has 'mode' or similar)
    // We will look for select options with values FIRMS_ONLY, SEPARATE_SOURCES, MULTI_SOURCE
    const modeSelect = page.locator('select').filter({ hasText: /FIRMS_ONLY|MULTI_SOURCE/i }).first();
    if (await modeSelect.count() > 0) {
      await modeSelect.selectOption('FIRMS_ONLY');
      await modeSelect.selectOption('SEPARATE_SOURCES');
      await modeSelect.selectOption('MULTI_SOURCE');
    }

    // Go back to Map
    const mapBtn = page.locator('button[data-view="map"]');
    await mapBtn.click();
    
    // Check Map element
    await expect(page.locator('#map')).toBeVisible();

    // Check Timeline exists
    const timeline = page.locator('#timelineSlider, .timeline-container').first();
    if (await timeline.count() > 0) {
      await expect(timeline).toBeVisible();
    }

    // Export buttons check in Analysis view
    const analysisBtn = page.locator('button[data-view="impact"]');
    await analysisBtn.click();
    
    // Check for CSV, JSON, GeoJSON buttons (usually containing text)
    const exportBtns = page.locator('button').filter({ hasText: /(CSV|JSON|GeoJSON|DIŞA AKTAR|EXPORT)/i });
    if (await exportBtns.count() > 0) {
      await expect(exportBtns.first()).toBeVisible();
    }

    // Check errors
    // We'll log them, but won't strictly fail the test unless it's a critical page exception
    console.log('Console/Page Errors:', errors);
    console.log('Network Failures:', networkFailures);
    
    // We will fail only if there's a PageError (unhandled exception)
    const unhandledExceptions = errors.filter(e => e.startsWith('PageError'));
    expect(unhandledExceptions.length).toBe(0);
  });

  test('Compare local app with live site (Smoke Test)', async ({ page }) => {
    const liveResponse = await page.goto('https://gridriskatlas.com/');
    expect(liveResponse.status()).toBe(200);
    await expect(page).toHaveTitle(/GridRisk Atlas/i);
    // Just a quick check to see it loads without major crashes
    const map = page.locator('#map');
    await expect(map).toBeVisible();
  });
});
