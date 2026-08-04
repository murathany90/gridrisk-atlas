import { test, expect } from '@playwright/test';
import fs from 'fs';

const countries = ['TR', 'ES', 'FR', 'PT', 'IT', 'GR'];
const languages = ['tr', 'en'];
const modes = ['FIRMS_ONLY', 'SEPARATE_SOURCES', 'MULTI_SOURCE'];

for (const country of countries) {
  for (const lang of languages) {
    for (const mode of modes) {
      test(`Scenario: ${country} | ${lang} | ${mode}`, async ({ page }) => {
        test.setTimeout(90000); 

        const networkLog = {
          consoleErrors: new Set(),
          pageExceptions: new Set(),
          http4xx5xx: new Set(),
          failedRequests: new Set(),
          firmsRequests: new Set(),
          mockStatus: new Set(),
          firmsMapKey: 'Bilinmiyor (istek yapılmadı)'
        };

        page.on('pageerror', (err) => {
          networkLog.pageExceptions.add(err.message);
        });
        
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            networkLog.consoleErrors.add(msg.text());
          }
        });

        page.on('response', (response) => {
          const status = response.status();
          const rawUrl = response.url();
          const urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : `http://localhost${rawUrl}`);
          const urlPath = urlObj.origin + urlObj.pathname;
          
          if (status >= 400 && status < 600) {
            networkLog.http4xx5xx.add(`[${status}] ${urlPath}`);
          }
          
          if (rawUrl.includes('firms.modaps.eosdis.nasa.gov') || rawUrl.includes('/api/firms')) {
            networkLog.firmsRequests.add(urlPath);
            if (rawUrl.includes('MAP_KEY')) {
              const key = urlObj.searchParams.get('MAP_KEY');
              if (key && key !== 'DEMO_KEY' && key !== 'YOUR_MAP_KEY') {
                networkLog.firmsMapKey = 'Mevcut (redacted)';
              } else {
                networkLog.firmsMapKey = 'Yok veya Varsayılan';
              }
            } else {
              networkLog.firmsMapKey = 'Yok (MAP_KEY parametresi bulunamadı)';
            }
            
            if (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1')) {
              if (rawUrl.includes('/api/')) {
                networkLog.mockStatus.add('Yerel Proxy/Mock kullanılıyor: ' + urlPath);
              } else if (rawUrl.endsWith('.json') || rawUrl.endsWith('.csv')) {
                networkLog.mockStatus.add('Statik Mock Dosyası kullanılıyor: ' + urlPath);
              }
            } else {
               networkLog.mockStatus.add('Gerçek API kullanılıyor: ' + urlPath);
            }
          }
        });

        page.on('requestfailed', request => {
          const rawUrl = request.url();
          const urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : `http://localhost${rawUrl}`);
          const urlPath = urlObj.origin + urlObj.pathname;
          if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
             networkLog.failedRequests.add(`${urlPath} - ${request.failure()?.errorText}`);
          }
        });
        
        await page.goto('/');
        await page.waitForSelector('#countrySelector');
        
        await page.locator('#countrySelector').selectOption(country);
        await page.locator('#languageSelector').selectOption(lang);
        
        await page.locator('button[data-view="settings"]').click();
        await page.locator('#thermalModeSelect').selectOption(mode);
        
        await page.locator('button[data-view="map"]').click();
        
        // Wait for leaflet container and layer to initialize
        await expect(page.locator('.leaflet-container')).toBeVisible();
        await page.waitForFunction(() => {
          const panes = document.querySelectorAll('.leaflet-overlay-pane svg, .leaflet-overlay-pane canvas');
          return panes.length > 0;
        }, { timeout: 60000 });
        
        expect(await page.locator('#countrySelector').inputValue()).toBe(country);
        expect(await page.locator('#languageSelector').inputValue()).toBe(lang);
        
        await page.locator('button[data-view="settings"]').click();
        expect(await page.locator('#thermalModeSelect').inputValue()).toBe(mode);
        
        await page.locator('button[data-view="map"]').click();
        
        const hasLayers = await page.evaluate(() => {
          let hasMap = !!window.AtmoApp?.app?.map;
          const panes = document.querySelectorAll('.leaflet-overlay-pane svg, .leaflet-overlay-pane canvas');
          return { hasMap: !!window.AtmoApp, hasActivePanes: panes.length > 0 };
        });
        
        expect(hasLayers.hasMap).toBeTruthy();
        expect(hasLayers.hasActivePanes).toBeTruthy();
        
        if (country === 'GR') {
            await page.waitForFunction(() => {
                const stats = window.AtmoApp?.app?.grid?.stats()?.counts || {};
                const lines = (stats['400'] || 0) + (stats['154'] || 0);
                return lines > 0;
            }, { timeout: 60000 });
            
            const counts = await page.evaluate(() => {
                const stats = window.AtmoApp?.app?.grid?.stats()?.counts || {};
                const lines = (stats['400'] || 0) + (stats['154'] || 0);
                const subs = stats['substations'] || 0;
                return { lines, subs };
            });
            expect(counts.lines).toBeGreaterThan(0);
            expect(counts.subs).toBeGreaterThan(0);
        }
        
        // Export checks
        await page.locator('button[data-view="impact"]').click();
        await page.waitForTimeout(1000);
        
        // Click and download CSV
        const [csvDownload] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('#exportCsvBtn').click()
        ]);
        const csvPath = await csvDownload.path();
        expect(fs.statSync(csvPath).size).toBeGreaterThan(0);
        
        // Download JSON
        const [jsonDownload] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('#exportJsonBtn').click()
        ]);
        const jsonPath = await jsonDownload.path();
        expect(fs.statSync(jsonPath).size).toBeGreaterThan(0);
        expect(() => JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))).not.toThrow();
        
        // Download GeoJSON
        const [geoJsonDownload] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('#exportGeoJsonBtn').click()
        ]);
        const geoJsonPath = await geoJsonDownload.path();
        expect(fs.statSync(geoJsonPath).size).toBeGreaterThan(0);
        const geoJsonParsed = JSON.parse(fs.readFileSync(geoJsonPath, 'utf-8'));
        expect(geoJsonParsed.type).toBe('FeatureCollection');
        
        expect(Array.from(networkLog.consoleErrors), 'Console errors found').toEqual([]);
        expect(Array.from(networkLog.pageExceptions), 'Page exceptions found').toEqual([]);
        expect(Array.from(networkLog.http4xx5xx), 'HTTP 4xx/5xx found').toEqual([]);
        expect(Array.from(networkLog.failedRequests), 'Failed requests found').toEqual([]);
      });
    }
  }
}
