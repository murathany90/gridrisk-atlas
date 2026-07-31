window.AtmoApp = window.AtmoApp || {};
(function(A){
  A.CONFIG = {
    appName: 'Türkiye Wildfire Grid Risk Monitor',
    appVersion: '3.3.7',
    defaultCenter: [39.0, 35.2],
    defaultZoom: 6,
    mapMinZoom: 2,
    dataRegionOnly: true,
    regionBounds: { west: 25.60, south: 35.75, east: 44.90, north: 42.20 },
    regionLabel: 'Türkiye veri alanı',
    regionPolygon: [
      [41.98,28.02],[41.92,27.60],[41.85,27.10],[41.48,26.32],[41.28,26.30],
      [40.85,26.35],[40.60,26.90],[40.30,26.50],[39.90,26.20],[39.30,26.20],
      [38.70,26.80],[38.20,26.90],[37.70,27.00],[37.50,27.20],[37.20,27.60],
      [36.90,28.00],[36.70,28.50],[36.55,29.00],[36.50,29.70],[36.55,30.40],
      [36.50,31.20],[36.50,32.10],[36.55,33.00],[36.60,34.00],[36.65,34.90],
      [36.55,35.60],[36.20,35.90],[36.30,36.30],[36.50,36.80],[36.70,37.20],
      [36.90,37.80],[37.00,38.50],[37.05,39.30],[37.10,40.20],[37.10,41.00],
      [37.15,41.60],[37.30,42.30],[37.50,42.90],[37.60,43.50],[37.75,44.10],
      [38.00,44.50],[38.50,44.60],[39.00,44.50],[39.40,44.60],[39.70,44.70],
      [39.90,44.50],[40.10,43.80],[40.40,43.30],[40.70,42.80],[41.00,42.30],
      [41.30,41.80],[41.50,41.40],[41.55,40.70],[41.50,39.80],[41.40,38.80],
      [41.30,37.80],[41.35,36.80],[41.50,36.00],[41.70,35.20],[41.85,34.30],
      [41.80,33.50],[41.70,32.70],[41.60,32.00],[41.45,31.30],[41.30,30.60],
      [41.10,29.80],[41.15,28.80],[41.45,28.20],[41.98,28.02]
    ],
    openMeteoAir: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    openMeteoWeather: 'https://api.open-meteo.com/v1/forecast',
    openMeteoGeocode: 'https://geocoding-api.open-meteo.com/v1/search',
    firmsBase: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv',
    firmsMapKey: '__FIRMS_MAP_KEY__',
    effisWms: 'https://maps.effis.emergency.copernicus.eu/effis',
    effisFwiLayer: 'ecmwf007.fwi',
    effisBurntAreaLayer: 'effis.nrt.ba.poly',
    atmoHubPortal: 'https://portal.atmohub.gr/',
    atmoHubDiscovery: '/api/atmohub/discover',
    timeline: { minHours: -48, maxHours: 12, playStepHours: 3, playIntervalMs: 1500 },
    cacheTtl: { air: 30*60*1000, weather: 60*60*1000, geocode: 60*60*1000, firms: 7*60*1000, grid: 24*60*60*1000 },
    firmsSources: ['VIIRS_NOAA21_NRT','VIIRS_NOAA20_NRT','VIIRS_SNPP_NRT','MODIS_NRT'],
    gfwApiKey: '__GFW_API_KEY__',
    eumetsatConsumerKey: '__EUMETSAT_CONSUMER_KEY__',
    eumetsatConsumerSecret: '__EUMETSAT_CONSUMER_SECRET__',
    baseMaps: {
      satellite: {
        label:'Uydu · Esri World Imagery',
        url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom:19,
        attribution:'Tiles © Esri — Esri, Maxar, Earthstar Geographics and the GIS User Community'
      },
      osm: {
        label:'OpenStreetMap Standard',
        url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maxZoom:19,
        attribution:'© OpenStreetMap contributors'
      },
      positron: {
        label:'CARTO Positron',
        url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        subdomains:'abcd',maxZoom:20,
        attribution:'© OpenStreetMap contributors © CARTO'
      },
      dark: {
        label:'CARTO Dark Matter',
        url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        subdomains:'abcd',maxZoom:20,
        attribution:'© OpenStreetMap contributors © CARTO'
      },
      topo: {
        label:'OpenTopoMap',
        url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        subdomains:'abc',maxZoom:17,
        attribution:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'
      }
    },
    gridSources: {
      '400': {label:'400 kV sınıfı',file:'data/grid_400.geojson',color:'#ef4444',weight:2.7,description:'OSM 300–500 kV ve >500 kV etiket grupları'},
      '154': {label:'154 kV sınıfı',file:'data/grid_154.geojson',color:'#172033',weight:1.9,description:'OSM 66–300 kV etiket grubu'},
      '33': {label:'20–66 kV',file:'data/grid_33.geojson',color:'#16a34a',weight:1.2,description:'OSM 20–66 kV ve <20 kV grupları'},
      'unknown': {label:'Gerilimi bilinmeyen',file:'data/grid_unknown.geojson',color:'#f97316',weight:1.0,description:'OSM voltage etiketi eksik hatlar'},
      'substations': {label:'Trafo merkezleri',file:'data/substations.geojson',color:'#f8fafc',weight:1.0,description:'OSM power=substation merkez noktaları'}
    },
    smokeVariables: {
      pm10_wildfires: { label:'Yangın kaynaklı PM10',unit:'µg/m³',source:'CAMS European Air Quality via Open-Meteo',resolution:'~11 km',type:'TAHMİN',surface:true,fireSpecific:true },
      wildfire_share: { label:'Yangın PM10 payı',unit:'%',source:'CAMS European Air Quality via Open-Meteo · toplam PM10 üzerinden türetilmiş oran',resolution:'~11 km',type:'TÜRETİLMİŞ',surface:true,fireSpecific:true }
    },
    windLevels: {
      '10m': {label:'10 m yüzey rüzgârı',speed:'wind_speed_10m',direction:'wind_direction_10m'},
      '850hPa': {label:'850 hPa rüzgârı',speed:'wind_speed_850hPa',direction:'wind_direction_850hPa'},
      '700hPa': {label:'700 hPa rüzgârı',speed:'wind_speed_700hPa',direction:'wind_direction_700hPa'}
    },
    firePolygonRange: { start: Date.now()-7*86400000, end: Date.now() },
    firePolygons: {
      url: 'https://admin.ihtiyacharitasi.org/server/rest/services/Hosted/yangin_alan2024_view/FeatureServer/2/query',
      label: 'Güncel Yangın Alanları',
      source: 'İhtiyaç Haritası / AFAD & OGM',
      fillColor: '#ff4500',
      fillOpacity: .18,
      strokeColor: '#ff4500',
      strokeWeight: 1.8,
      markerColor: '#ff6b35'
    },
    fireClustering: { radiusKm: 5, timeHours: 6 },
    downwind: { distanceKm: 50, halfAngleDeg: 22, maxCorridors: 30 },
    impactBands: [
      {maxKm:1,label:'Kritik yakınlık',level:'critical'},
      {maxKm:3,label:'Yüksek yakınlık',level:'high'},
      {maxKm:10,label:'Orta yakınlık',level:'medium'},
      {maxKm:25,label:'İzleme alanı',level:'watch'}
    ],
    riskScoreBands: [
      {min:75,label:'Kritik',level:'critical'},
      {min:55,label:'Yüksek',level:'high'},
      {min:35,label:'Orta',level:'medium'},
      {min:0,label:'İzleme',level:'watch'}
    ]
  };
})(window.AtmoApp);
