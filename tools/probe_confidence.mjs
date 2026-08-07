const BASE = "https://view.eumetsat.int/geoserver/ows";
const TR = { west: 25.60, south: 35.75, east: 44.90, north: 42.20 };
const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
const cql = `BBOX(geom, ${TR.south}, ${TR.west}, ${TR.north}, ${TR.east}) AND time >= '${iso(120)}' AND time <= '${iso(0)}'`;

async function fetchConf(layer) {
  const url = `${BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&outputFormat=application/json&count=100&cql_filter=${cql}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const conf = data.features.map(f => f.properties.Confidence).filter(c => c != null);
    if (!conf.length) return console.log(`${layer}: no features or confidence field`);
    const nums = conf.map(Number).filter(n => !isNaN(n));
    console.log(`${layer} - Features: ${data.features.length}`);
    console.log(`Min: ${Math.min(...nums)}, Max: ${Math.max(...nums)}`);
    console.log(`Unique examples: ${[...new Set(conf)].slice(0, 15).join(', ')}`);
  } catch(e) {
    console.error(e);
  }
}

async function main() {
  await fetchConf("mtg_fd:frp");
  await fetchConf("copernicus:sentinel3a_slstr_level2_frp");
  await fetchConf("copernicus:sentinel3b_slstr_level2_frp");
}
main();
