import { test, expect } from '@playwright/test';
import fs from 'fs';

const countries = ['TR', 'ES', 'FR', 'PT', 'IT', 'GR'];
const languages = ['tr', 'en'];
const modes = ['FIRMS_ONLY', 'SEPARATE_SOURCES', 'MULTI_SOURCE'];

let networkLog = {
  consoleErrors: new Set(),
  pageExceptions: new Set(),
  http4xx5xx: new Set(),
  failedRequests: new Set(),
  firmsRequests: new Set(),
  mockStatus: new Set(),
  firmsMapKey: 'Bilinmiyor (istek yapılmadı)'
};

test.beforeEach(async ({ page }) => {
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
    const url = response.url();
    
    if (status >= 400 && status < 600) {
      networkLog.http4xx5xx.add(`[${status}] ${url}`);
    }
    
    if (url.includes('firms.modaps.eosdis.nasa.gov') || url.includes('/api/firms')) {
      networkLog.firmsRequests.add(url);
      if (url.includes('MAP_KEY')) {
        const urlObj = new URL(url.startsWith('http') ? url : `http://localhost${url}`);
        const key = urlObj.searchParams.get('MAP_KEY');
        if (key && key !== 'DEMO_KEY' && key !== 'YOUR_MAP_KEY') {
          networkLog.firmsMapKey = 'Mevcut (Gizlenmedi: ' + key + ')';
        } else {
          networkLog.firmsMapKey = 'Yok veya Varsayılan (' + key + ')';
        }
      } else {
        networkLog.firmsMapKey = 'Yok (MAP_KEY parametresi bulunamadı)';
      }
      
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        if (url.includes('/api/')) {
          networkLog.mockStatus.add('Yerel Proxy/Mock kullanılıyor: ' + url);
        } else if (url.endsWith('.json') || url.endsWith('.csv')) {
          networkLog.mockStatus.add('Statik Mock Dosyası kullanılıyor: ' + url);
        }
      } else {
         networkLog.mockStatus.add('Gerçek API kullanılıyor: ' + url);
      }
    }
  });

  page.on('requestfailed', request => {
    // Only log if it's not a generic abort due to fast navigation
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
       networkLog.failedRequests.add(`${request.url()} - ${request.failure()?.errorText}`);
    }
  });
});

test.afterAll(() => {
  console.log('\n=========================================');
  console.log('NETWORK & ERROR SUMMARY');
  console.log('=========================================');
  console.log('Console Errors:', Array.from(networkLog.consoleErrors));
  console.log('Page Exceptions:', Array.from(networkLog.pageExceptions));
  console.log('HTTP 4xx/5xx:', Array.from(networkLog.http4xx5xx));
  console.log('Failed Requests:', Array.from(networkLog.failedRequests));
  console.log('FIRMS Requests:', Array.from(networkLog.firmsRequests));
  console.log('Mock Status:', Array.from(networkLog.mockStatus));
  console.log('FIRMS_MAP_KEY Status:', networkLog.firmsMapKey);
  console.log('=========================================\n');
});

for (const country of countries) {
  for (const lang of languages) {
    for (const mode of modes) {
      test(`Scenario: ${country} | ${lang} | ${mode}`, async ({ page }) => {
        test.setTimeout(90000); 
        
        await page.goto('/');
        await page.waitForSelector('#countrySelector');
        
        await page.locator('#countrySelector').selectOption(country);
        await page.locator('#languageSelector').selectOption(lang);
        
        await page.locator('button[data-view="settings"]').click();
        await page.locator('#thermalModeSelect').selectOption(mode);
        
        await page.locator('button[data-view="map"]').click();
        
        // Wait for leaflet container and layer to initialize
        await expect(page.locator('.leaflet-container')).toBeVisible();
        await page.waitForTimeout(2000); // Give time for geojson fetches to start/finish
        
        expect(await page.locator('#countrySelector').inputValue()).toBe(country);
        expect(await page.locator('#languageSelector').inputValue()).toBe(lang);
        
        await page.locator('button[data-view="settings"]').click();
        expect(await page.locator('#thermalModeSelect').inputValue()).toBe(mode);
        
        await page.locator('button[data-view="map"]').click();
        
        const hasLayers = await page.evaluate(() => {
          let hasMap = !!window.AtmoApp?.app?.map; // or window.AtmoApp
          // Actually let's just check if AtmoApp exists and has anything map related
          // To be safe we will check DOM for leaflet active layers
          const panes = document.querySelectorAll('.leaflet-overlay-pane svg, .leaflet-overlay-pane canvas');
          return { hasMap: !!window.AtmoApp, hasActivePanes: panes.length > 0 };
        });
        
        expect(hasLayers.hasMap).toBeTruthy();
        
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
      });
    }
  }
}
