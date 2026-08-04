#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const countries = ['ES', 'FR', 'PT', 'IT', 'GR'];
const filenames = ['boundary.geojson', 'grid_400.geojson', 'grid_154.geojson', 'substations.geojson', 'manifest.json'];
const report = { generatedAt: new Date().toISOString(), countries: {} };

for (const country of countries) {
  const files = {};
  const totals = { bytes: 0, gzipBytes: 0, brotliBytes: 0 };
  for (const filename of filenames) {
    const path = `data/countries/${country}/${filename}`;
    const data = readFileSync(path);
    const row = {
      bytes: data.length,
      gzipBytes: gzipSync(data, { level: 9 }).length,
      brotliBytes: brotliCompressSync(data, {
        // Quality 6 is representative of deploy-time compression without
        // turning a repeatable size report into a multi-minute build step.
        params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
      }).length,
    };
    files[filename] = row;
    for (const key of Object.keys(totals)) totals[key] += row[key];
  }
  report.countries[country] = { files, totals };
}

mkdirSync('reports', { recursive: true });
writeFileSync('reports/runtime_sizes.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const lines = [
  '# Avrupa OSM runtime dağıtım boyutları',
  '',
  `Oluşturulma: \`${report.generatedAt}\``,
  '',
  '| Ülke | Ham bayt | gzip bayt | brotli bayt |',
  '|---|---:|---:|---:|',
  ...countries.map(country => {
    const totals = report.countries[country].totals;
    return `| ${country} | ${totals.bytes} | ${totals.gzipBytes} | ${totals.brotliBytes} |`;
  }),
];
writeFileSync('reports/runtime_sizes.md', `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify(report.countries, null, 2));
