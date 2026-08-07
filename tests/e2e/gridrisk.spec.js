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
        
        // hermetic environment: EFFIS WMS tiles are external and can return
        // ERR_HTTP2_PROTOCOL_ERROR during CI runs, which would surface as console errors
        await mockEffisTiles(page);
        
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

for (const lang of ['tr', 'en']) {
  test(`Evidence: TR mock fires near grid lines | ${lang} | full evidence lifecycle`, async ({ page }) => {
    test.setTimeout(120000);

    const consoleErrors = new Set();
    const pageExceptions = new Set();
    page.on('pageerror', (err) => pageExceptions.add(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.add(msg.text());
    });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const acqDate = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    const acqTime = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
    const header = 'latitude,longitude,bright_ti4,bright_ti5,frp,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,daynight';
    const nearRow = `36.95,28.64,330,310,45,0.375,0.375,${acqDate},${acqTime},NPP,VIIRS,high,2.0,D`;
    const fethiyeCsvRow = `36.7318,28.9989,335,315,120,0.375,0.375,${acqDate},${acqTime},NPP,VIIRS,high,2.0,D`;
    const csv = [header, nearRow, fethiyeCsvRow].join('\n');
    const emptyCsv = header;

    let returnEmpty = false;
    let firmsCalls = 0;
    await page.route('**/firms.modaps.eosdis.nasa.gov/**', (route) => {
      firmsCalls++;
      route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: returnEmpty ? emptyCsv : csv,
      });
    });

    // hermetic environment: the wind/smoke endpoints are external and can
    // return 503 during CI runs, which would surface as console errors
    const times = Array.from({ length: 48 }, (_, i) => {
      const t = new Date(now.getTime() + (i - 24) * 3600e3);
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:00`;
    });
    const zeros = Array(48).fill(0);
    await page.route('**://api.open-meteo.com/**', (route) => {
      const url = new URL(route.request().url());
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          latitude: Number(url.searchParams.get('latitude')) || 39,
          longitude: Number(url.searchParams.get('longitude')) || 35,
          hourly: {
            time: times,
            wind_speed_10m: Array(48).fill(8),
            wind_direction_10m: Array(48).fill(140),
            wind_gusts_10m: Array(48).fill(12),
            temperature_2m: Array(48).fill(24),
            relative_humidity_2m: Array(48).fill(40),
            precipitation: zeros,
            wind_speed_850hPa: Array(48).fill(15),
            wind_direction_850hPa: Array(48).fill(150),
            wind_speed_700hPa: Array(48).fill(20),
            wind_direction_700hPa: Array(48).fill(160),
          },
          hourly_units: {},
        }),
      });
    });
    await page.route('**://air-quality-api.open-meteo.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          latitude: 39,
          longitude: 35,
          hourly: { time: times, pm10_wildfires: zeros, pm10: zeros },
          hourly_units: {},
        }),
      });
    });

    const layerCount = () =>
      page.evaluate(() => window.AtmoApp.app.map.riskEvidenceLayer.getLayers().length);

    // hermetic environment: EFFIS WMS tiles are external and can return
    // ERR_HTTP2_PROTOCOL_ERROR during CI runs, which would surface as console errors
    await mockEffisTiles(page);

    await page.goto('/');
    await page.waitForSelector('#countrySelector');
    await page.evaluate(() => {
      window.AtmoApp.CONFIG.firmsMapKey = 'E2E_TEST_KEY';
    });
    await page.locator('#countrySelector').selectOption('TR');
    await page.locator('#languageSelector').selectOption(lang);

    await page.locator('button[data-view="settings"]').click();
    await page.locator('#thermalModeSelect').selectOption('FIRMS_ONLY');
    await page.locator('button[data-view="map"]').click();
    // boot gates loadFirms on the MAP_KEY (set by the test above); drive the
    // load explicitly so the mocked payload is always fetched
    await page.evaluate(() => window.AtmoApp.app.loadFirms());

    // 1) state: two risky lines, each triggered by its own nearest raw detection
    await page.waitForFunction(() => {
      const impacts = window.AtmoApp?.app?.state?.fireImpacts || [];
      return impacts.filter((a) => a.evidence?.lineId).length >= 2;
    }, { timeout: 60000 });

    const mugla = await page.evaluate(() => {
      const impacts = window.AtmoApp.app.state.fireImpacts;
      return impacts
        .filter((a) => a.evidence)
        .map((a) => ({ ...a.evidence, score: a.riskScore, dist: a.minDistanceKm }))
        .find((e) => e.triggerFrpMw === 45);
    });
    expect(mugla).not.toBeNull();
    expect(mugla.selectionRule).toBe('nearest_raw_detection');
    expect(mugla.triggerDistanceKm).toBeGreaterThan(0);
    expect(mugla.triggerDistanceKm).toBeLessThan(5);
    expect(mugla.triggerDistanceKm).toBeCloseTo(mugla.dist, 2);
    expect(mugla.evidenceCount).toBeGreaterThan(0);

    const fethiye = await page.evaluate(() => {
      const impacts = window.AtmoApp.app.state.fireImpacts;
      return impacts
        .filter((a) => a.evidence)
        .map((a) => ({ ...a.evidence, score: a.riskScore }))
        .find((e) => e.triggerFrpMw === 120);
    });
    expect(fethiye).not.toBeNull();
    expect(fethiye.lineId).not.toBe(mugla.lineId);
    expect(fethiye.triggerDistanceKm).toBeLessThan(5);

    const crossContamination = await page.evaluate((muglaId) => {
      const impacts = window.AtmoApp.app.state.fireImpacts;
      return impacts.some(
        (a) => a.evidence?.lineId === muglaId && a.evidence?.triggerFrpMw !== 45,
      );
    }, mugla.lineId);
    expect(crossContamination).toBeFalsy();

    // 2) impact table: two evidence rows, correct trigger cells
    await page.locator('button[data-view="impact"]').click();
    const muglaRow = page.locator('#impactTableBody tr[data-risk-index]', { hasText: '45 MW' });
    const fethiyeRow = page.locator('#impactTableBody tr[data-risk-index]', { hasText: '120 MW' });
    await expect(muglaRow).toBeVisible();
    await expect(fethiyeRow).toBeVisible();
    await expect(muglaRow).toContainText('NPP');
    await expect(fethiyeRow).toContainText('NPP');

    // 3) evidence button: aria-label + >= 40x40 touch target
    const btn = muglaRow.locator('button.evidenceBtn');
    await expect(btn).toBeVisible();
    await expect
      .poll(() =>
        btn.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return !!el.getAttribute('aria-label') && r.width >= 40 && r.height >= 40;
        }),
      )
      .toBe(true);

    const overflowImpact = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowImpact).toBeLessThanOrEqual(0);

    // 4) export CSV: all trigger_* columns present with real data rows
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#exportCsvBtn').click(),
    ]);
    const csvPath = await csvDownload.path();
    const csvText = fs.readFileSync(csvPath, 'utf-8');
    for (const col of [
      'triggerDetectionId',
      'triggerSource',
      'triggerSatellite',
      'triggerInstrument',
      'triggerProduct',
      'triggerDetectedAt',
      'triggerFrpMw',
      'triggerConfidence',
      'triggerLatitude',
      'triggerLongitude',
      'triggerDistanceKm',
      'nearestLineLatitude',
      'nearestLineLongitude',
      'eventCenterLatitude',
      'eventCenterLongitude',
      'evidenceCount',
      'selectionRule',
    ]) {
      expect(csvText).toContain(col);
    }
    expect(csvText).toContain('nearest_raw_detection');
    expect(csvText).toContain('36.95');
    expect(csvText).toContain('28.64');

    // 5) detail panel with evidence section (localized)
    await btn.click();
    await expect(page.locator('#detailPanel')).toBeVisible();
    await expect(page.locator('#detailPanel')).toContainText(
      lang === 'tr' ? 'Risk Nedeni' : 'Risk Evidence',
    );
    await expect(page.locator('#detailPanel')).toContainText('nearest_raw_detection');

    // 6) map layer: trigger marker + connector + nearest point + legend (localized)
    expect(await layerCount()).toBe(4);
    const legend = page.locator('[data-legend="evidence"]');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(lang === 'tr' ? 'Risk Kanıtı' : 'Risk Evidence');

    // 6) toggle off hides marker, connector and nearest point; on restores
    //    (desktop keeps the layer panel floating over the map view; mobile moves
    //    it into the settings view, so open whichever view hosts the panel)
    await page.evaluate(() => window.AtmoApp.app.ui.closeDetail(true));
    const openLayerPanelView = async () => {
      const host = await page.evaluate(
        () =>
          document
            .getElementById('layerPanelBody')
            ?.closest('section.view')?.id === 'view-settings'
            ? 'settings'
            : 'map',
      );
      await page.locator(`button[data-view="${host}"]`).click();
    };
    await openLayerPanelView();
    const riskGroupToggle = page
      .locator('section.layerGroup', { has: page.locator('#layerRiskEvidence') })
      .locator('button.layerGroupToggle');
    await riskGroupToggle.click();
    await page.locator('#layerRiskEvidence').uncheck();
    await page.locator('button[data-view="map"]').click();
    await expect.poll(layerCount, { timeout: 15000 }).toBe(0);
    await expect(page.locator('[data-legend="evidence"]')).toHaveCount(0);
    await openLayerPanelView();
    await page.locator('#layerRiskEvidence').check();
    await page.locator('button[data-view="map"]').click();
    await expect.poll(layerCount, { timeout: 15000 }).toBe(4);

    // 7) fires main layer off: evidence pixel still shown
    await openLayerPanelView();
    await page.locator('#layerFires').uncheck();
    await page.locator('button[data-view="map"]').click();
    expect(await layerCount()).toBe(4);
    await openLayerPanelView();
    await page.locator('#layerFires').check();
    await page.locator('button[data-view="map"]').click();

    // 8) selecting the other line replaces the evidence (no stacking)
    await page.locator('button[data-view="impact"]').click();
    await fethiyeRow.locator('button.evidenceBtn').click();
    await page.waitForFunction(
      (oldId) =>
        window.AtmoApp.app.map.lastRiskEvidence?.lineId !== oldId &&
        window.AtmoApp.app.map.lastRiskEvidence?.lineId !== undefined,
      mugla.lineId,
      { timeout: 30000 },
    );
    const switched = await page.evaluate(() => window.AtmoApp.app.map.lastRiskEvidence);
    expect(switched.triggerFrpMw).toBe(120);
    expect(await layerCount()).toBe(4);

    // 9) timeline change clears stale evidence
    await page.locator('#timeSlider').evaluate((el) => {
      el.value = '-48';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(
      () => (window.AtmoApp?.app?.state?.fireImpacts || []).length === 0,
      { timeout: 60000 },
    );
    expect(await layerCount()).toBe(0);
    await expect(page.locator('[data-legend="evidence"]')).toHaveCount(0);

    // 10) reload, restore evidence, then refresh with empty FIRMS payload clears it
    //     (boot gates loadFirms on the MAP_KEY; the key is set by the test after
    //     boot, so drive the load explicitly like the refresh button does)
    await page.reload();
    await page.waitForSelector('#countrySelector');
    await page.evaluate(() => {
      window.AtmoApp.CONFIG.firmsMapKey = 'E2E_TEST_KEY';
    });
    await page.locator('#countrySelector').selectOption('TR');
    await page.locator('button[data-view="settings"]').click();
    await page.locator('#thermalModeSelect').selectOption('FIRMS_ONLY');
    await page.locator('button[data-view="map"]').click();
    await page.evaluate(() => window.AtmoApp.app.loadFirms());
    await page.waitForFunction(
      () =>
        (window.AtmoApp?.app?.state?.fireImpacts || []).filter(
          (a) => a.evidence?.lineId,
        ).length >= 2,
      { timeout: 60000 },
    );
    await page.locator('button[data-view="impact"]').click();
    await page
      .locator('#impactTableBody tr[data-risk-index]', { hasText: '45 MW' })
      .locator('button.evidenceBtn')
      .click();
    await expect.poll(layerCount, { timeout: 15000 }).toBe(4);
    returnEmpty = true;
    await page.locator('#refreshAllBtn').click();
    await page.waitForFunction(
      () =>
        (window.AtmoApp?.app?.state?.fireImpacts || []).length === 0 &&
        window.AtmoApp.app.map.lastRiskEvidence === null,
      { timeout: 60000 },
    );
    expect(await layerCount()).toBe(0);

    // 11) country change clears evidence and selection
    await page.locator('#countrySelector').selectOption('ES');
    await page.waitForFunction(
      () =>
        window.AtmoApp?.app?.state?.countryCode === 'ES' &&
        window.AtmoApp?.app?.grid?.loadedCore === true,
      { timeout: 60000 },
    );
    expect(await layerCount()).toBe(0);
    expect(await page.evaluate(() => window.AtmoApp.app.state.selectedPoint)).toBeNull();

    const overflowMap = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowMap).toBeLessThanOrEqual(0);

    expect(firmsCalls).toBeGreaterThanOrEqual(4);
    expect(Array.from(consoleErrors), 'Console errors found').toEqual([]);
    expect(Array.from(pageExceptions), 'Page exceptions found').toEqual([]);
  });
}

const emptyWfs = { type: 'FeatureCollection', features: [], totalMatched: 0, numberReturned: 0 };

async function mockOpenMeteo(page) {
  const times = Array.from({ length: 48 }, (_, i) => {
    const t = new Date(Date.now() + (i - 24) * 3600e3);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}T${String(t.getUTCHours()).padStart(2, '0')}:00`;
  });
  const zeros = Array(48).fill(0);
  await page.route('**://api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        latitude: Number(url.searchParams.get('latitude')) || 39,
        longitude: Number(url.searchParams.get('longitude')) || 35,
        hourly: {
          time: times,
          wind_speed_10m: Array(48).fill(8),
          wind_direction_10m: Array(48).fill(140),
          wind_gusts_10m: Array(48).fill(12),
          temperature_2m: Array(48).fill(24),
          relative_humidity_2m: Array(48).fill(40),
          precipitation: zeros,
          wind_speed_850hPa: Array(48).fill(15),
          wind_direction_850hPa: Array(48).fill(150),
          wind_speed_700hPa: Array(48).fill(20),
          wind_direction_700hPa: Array(48).fill(160),
        },
        hourly_units: {},
      }),
    });
  });
  await page.route('**://air-quality-api.open-meteo.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        latitude: 39,
        longitude: 35,
        hourly: { time: times, pm10_wildfires: zeros, pm10: zeros },
        hourly_units: {},
      }),
    });
  });
}

async function mockEffisTiles(page) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('**://maps.effis.emergency.copernicus.eu/**', (route) => {
    route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
}

async function thermalSourceInfo(page, name) {
  return page.evaluate((n) => {
    const tbody = document.getElementById('thermalSourcesBody');
    if (tbody && tbody.querySelector('tr')) {
      const tr = Array.from(tbody.querySelectorAll('tr')).find(
        (r) => r.firstElementChild && r.firstElementChild.textContent.includes(n),
      );
      if (!tr) return null;
      const tds = Array.from(tr.querySelectorAll('td'));
      return {
        kind: 'row',
        status: tds[1] ? tds[1].textContent.trim() : '',
        note: tds.length > 1 ? tds[tds.length - 1].textContent.trim() : '',
      };
    }
    const card = Array.from(document.querySelectorAll('.sourceCard')).find((c) =>
      c.querySelector('summary').textContent.includes(n),
    );
    if (!card) return null;
    return {
      kind: 'card',
      status: (card.querySelector('summary').lastChild?.textContent || '').trim(),
      note: (card.querySelector('.sourceCardBody')?.textContent || '').trim(),
    };
  }, name);
}

test('Thermal source status table shows all planned sources', async ({ page }) => {
  test.setTimeout(90000);
  const consoleErrors = new Set();
  const pageExceptions = new Set();
  page.on('pageerror', (err) => pageExceptions.add(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.add(msg.text());
  });
  let wfsCalls = 0;
  await page.route('**://view.eumetsat.int/**request=GetFeature*', (route) => {
    wfsCalls++;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyWfs),
    });
  });
  await mockOpenMeteo(page);
  await mockEffisTiles(page);

  await page.goto('/');
  await page.waitForSelector('#countrySelector');
  await page.locator('#countrySelector').selectOption('TR');
  await page.locator('#languageSelector').selectOption('en');
  await page.locator('button[data-view="settings"]').click();

  const labels = await page.evaluate(() => {
    const tbody = document.getElementById('thermalSourcesBody');
    if (tbody && tbody.querySelector('tr')) {
      return Array.from(tbody.querySelectorAll('tr')).map(
        (r) => r.firstElementChild.textContent,
      );
    }
    return Array.from(document.querySelectorAll('.sourceCard')).map((c) =>
      c.querySelector('summary').textContent,
    );
  });
  expect(labels.length).toBe(8);
  expect(labels.join('|')).toContain('VIIRS NOAA-21');
  expect(labels.join('|')).toContain('VIIRS NOAA-20');
  expect(labels.join('|')).toContain('VIIRS Suomi-NPP');
  expect(labels.join('|')).toContain('MODIS Terra/Aqua');
  expect(labels.join('|')).toContain('Sentinel-3A SLSTR');
  expect(labels.join('|')).toContain('Sentinel-3B SLSTR');
  expect(labels.join('|')).toContain('MTG FCI FRP');
  expect(labels.join('|')).toContain('Multi-sensor result');

  await expect.poll(() => thermalSourceInfo(page, 'MTG FCI FRP'), { timeout: 30000 }).toMatchObject({
    status: 'No data',
  });
  await expect.poll(() => thermalSourceInfo(page, 'MODIS Terra/Aqua'), { timeout: 30000 }).toMatchObject({
    status: 'Disabled',
  });
  const modisInfo = await thermalSourceInfo(page, 'MODIS Terra/Aqua');
  expect(modisInfo.kind === 'card' ? modisInfo.note : modisInfo.note).toContain(
    'Manual selection',
  );
  await expect.poll(() => thermalSourceInfo(page, 'Multi-sensor result'), { timeout: 30000 }).toMatchObject({
    status: 'Disabled',
  });
  expect(wfsCalls).toBeGreaterThanOrEqual(1);
  expect(Array.from(consoleErrors), 'Console errors found').toEqual([]);
  expect(Array.from(pageExceptions), 'Page exceptions found').toEqual([]);
});

test('MTG stays disabled in FIRMS_ONLY and never queries EUMETView', async ({ page }) => {
  test.setTimeout(90000);
  const consoleErrors = new Set();
  const pageExceptions = new Set();
  page.on('pageerror', (err) => pageExceptions.add(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.add(msg.text());
  });
  let wfsRequests = 0;
  page.on('request', (req) => {
    if (req.url().includes('request=GetFeature')) wfsRequests++;
  });
  await mockEffisTiles(page);
  await page.addInitScript(() => {
    localStorage.setItem('thermalMode', 'FIRMS_ONLY');
  });

  await page.goto('/');
  await page.waitForSelector('#countrySelector');
  await page.locator('#languageSelector').selectOption('en');
  await page.locator('button[data-view="settings"]').click();
  await page.locator('#thermalModeSelect').selectOption('FIRMS_ONLY');
  await page.locator('button[data-view="map"]').click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.locator('button[data-view="settings"]').click();

  await expect.poll(() => thermalSourceInfo(page, 'MTG FCI FRP'), { timeout: 30000 }).toMatchObject({
    status: 'Disabled',
  });
  await expect.poll(() => thermalSourceInfo(page, 'Multi-sensor result'), { timeout: 30000 }).toMatchObject({
    status: 'Disabled',
  });
  await page.waitForTimeout(1500);
  expect(wfsRequests).toBe(0);
  expect(Array.from(consoleErrors), 'Console errors found').toEqual([]);
  expect(Array.from(pageExceptions), 'Page exceptions found').toEqual([]);
});

test('Service status table keeps supporting services without NASA FIRMS', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.waitForSelector('#countrySelector');
  await page.locator('#languageSelector').selectOption('en');
  await page.locator('button[data-view="settings"]').click();
  const supportingRows = page.locator('#serviceStatusBody tr');
  await expect(supportingRows.first()).toBeVisible();
  expect(await supportingRows.count()).toBeGreaterThanOrEqual(5);
  const supportingText = await supportingRows.allTextContents();
  expect(supportingText.join('|')).not.toContain('NASA FIRMS');
  expect(supportingText.join('|')).toContain('Basemap');
  await expect.poll(() => thermalSourceInfo(page, 'VIIRS NOAA-21'), { timeout: 30000 }).toBeTruthy();
});

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('Thermal source cards render on mobile', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/');
    await page.waitForSelector('#countrySelector');
    await page.locator('#languageSelector').selectOption('en');
    await page.locator('button[data-view="settings"]').click();
    expect(await page.locator('#thermalSourcesBody tr').count()).toBe(0);
    const cards = page.locator('#thermalCards .sourceCard');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBe(8);
    await expect(cards.first().locator('summary')).toContainText('VIIRS NOAA-21');
    const modisCard = page.locator('#thermalCards .sourceCard', { hasText: 'MODIS Terra/Aqua' });
    await expect(modisCard.locator('summary')).toContainText('Disabled');
  });
});
