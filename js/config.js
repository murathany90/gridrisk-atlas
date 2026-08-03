window.AtmoApp = window.AtmoApp || {};
(function(A){
  A.CONFIG = {
    appName: 'GridRisk Atlas',
    appVersion: '3.7.0',
    activeCountryCode: 'TR',
    defaultCenter: [39.0, 35.2],
    defaultZoom: 6,
    mapMinZoom: 2,
    dataRegionOnly: true,
    regionBounds: { west: 25.60, south: 35.75, east: 44.90, north: 42.20 },
    regionLabel: 'Türkiye veri alanı',
    regionGeometry: null,
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
    timeline: { minHours: -48, maxHours: 12, playStepHours: 3, playIntervalMs: 1500, mtgPlayStepMinutes: 10 },
    cacheTtl: { air: 30*60*1000, weather: 60*60*1000, geocode: 60*60*1000, firms: 7*60*1000, grid: 24*60*60*1000 },
    firmsSources: ['VIIRS_NOAA21_NRT','VIIRS_NOAA20_NRT','VIIRS_SNPP_NRT','MODIS_NRT'],
    thermalSources: {
      mode: 'FIRMS_ONLY',
      enabled: {
        firms: true,
        sentinel3a: false,
        sentinel3b: false,
        mtg: false,
        msg: false
      },
      meta: {
        'nasa-firms': { labelKey: 'thermal.source.firms', required: true, featureFlag: false },
        'sentinel3a-slstr': { labelKey: 'thermal.source.sentinel3a', required: false, featureFlag: true },
        'sentinel3b-slstr': { labelKey: 'thermal.source.sentinel3b', required: false, featureFlag: true },
        'mtg-fci-frp': { labelKey: 'thermal.source.mtg', required: false, featureFlag: true },
        'msg-seviri-frp': { labelKey: 'thermal.source.msg', required: false, featureFlag: true }
      }
    },
    thermalFusion: {
      enabled: false,
      association: {
        viirsToSlstr: { maxDistanceKm: 2.5, maxTimeMinutes: 90 },
        viirsToMtg: { maxDistanceKm: 4, maxTimeMinutes: 30 },
        slstrToMtg: { maxDistanceKm: 4, maxTimeMinutes: 45 }
      }
    },
    eumetviewWfs: {
      base: 'https://view.eumetsat.int/geoserver/ows',
      version: '2.0.0',
      outputFormat: 'application/json',
      count: 2000,
      maxPages: 20,
      timeoutMs: 30000,
      cacheTtlMs: 7 * 60 * 1000,
      timeField: 'time'
    },
    mtgGeoColourWms: {
      label: 'EUMETSAT MTG-I GeoColour RGB',
      url: 'https://view.eumetsat.int/geoserver/wms',
      layer: 'mtg_fd:rgb_geocolour',
      format: 'image/png',
      version: '1.3.0',
      crs: 'EPSG:4326',
      attribution: 'Imagery © EUMETSAT 2026',
      defaultOpacity: 0.85,
      slotMinutes: 10,
      maxBackfillSlots: 12,
      frameSettleMs: 3000,
      probeBbox: '35,26,43,46',
      source: 'EUMETSAT MTG-I FCI'
    },
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
      '400': {labelKey:'layers.grid400',label:'400 kV',file:'data/countries/TR/grid_400.geojson',color:'#d7191c',weight:2.2,description:'OSM 300–550 kV'},
      '154': {labelKey:'layers.grid154',label:'154 kV',file:'data/countries/TR/grid_154.geojson',color:'#111111',weight:1.5,description:'OSM 50–299.999 kV'},
      'substations': {labelKey:'layers.substations',label:'Substations',file:'data/countries/TR/substations.geojson',color:'#111111',weight:1.0,description:'OSM power=substation points'}
    },
    smokeVariables: {
      pm10_wildfires: { labelKey:'layers.smoke',unit:'µg/m³',source:'CAMS European Air Quality via Open-Meteo',resolution:'~11 km',type:'forecast',surface:true,fireSpecific:true }
    },
    windLevels: {
      '10m': {labelKey:'layers.wind10',label:'10 m',speed:'wind_speed_10m',direction:'wind_direction_10m'},
      '850hPa': {labelKey:'layers.wind850',label:'850 hPa',speed:'wind_speed_850hPa',direction:'wind_direction_850hPa'},
      '700hPa': {labelKey:'layers.wind700',label:'700 hPa',speed:'wind_speed_700hPa',direction:'wind_direction_700hPa'}
    },
    fireClustering: { radiusKm: 5, timeHours: 6 },
    NEARBY_FIRMS_RADIUS_KM: 10,
    frpThreshold: 30,
    downwind: {
      minDistanceKm: 10,
      maxDistanceKm: 30,
      fallbackWindSpeedKmh: 15,
      windWeight: 0.65,
      fireWeight: 0.35,
      windMinKmh: 5,
      windMaxKmh: 35,
      frpMinMw: 30,
      frpMaxMw: 300,
      halfAngleDeg: 22,
      maxCorridors: 30
    },
    substationRiskDisplayDistanceKm: 5,
    impactBands: [
      {maxKm:0.5,labelKey:'proximity.critical',level:'critical'},
      {maxKm:1.5,labelKey:'proximity.high',level:'high'},
      {maxKm:3,labelKey:'proximity.medium',level:'medium'},
      {maxKm:5,labelKey:'proximity.watch',level:'watch'}
    ],
    riskScoreBands: [
      {min:75,labelKey:'risk.critical',level:'critical'},
      {min:55,labelKey:'risk.high',level:'high'},
      {min:35,labelKey:'risk.medium',level:'medium'},
      {min:0,labelKey:'risk.watch',level:'watch'}
    ]
  };
  Object.defineProperty(A.CONFIG, "thermal", {
    enumerable: true,
    configurable: true,
    get() {
      return {
        mode: A.CONFIG.thermalSources.mode,
        fusion: A.CONFIG.thermalFusion,
        sources: Object.fromEntries(
          Object.entries(A.CONFIG.thermalSources.meta).map(([id, m]) => {
            const key = { "nasa-firms": "firms", "sentinel3a-slstr": "sentinel3a", "sentinel3b-slstr": "sentinel3b", "mtg-fci-frp": "mtg", "msg-seviri-frp": "msg" }[id] || id;
            return [id, { ...m, enabled: !!A.CONFIG.thermalSources.enabled[key] }];
          }),
        ),
      };
    },
  });
  A.COUNTRIES = {
    TR: {
      code:'TR',name:{tr:'Türkiye',en:'Türkiye'},nameTr:'Türkiye',timezone:'Europe/Istanbul',center:[39.0,35.2],zoom:6,
      coverageNote:{tr:'Türkiye',en:'Türkiye'},boundaryUrl:'data/countries/TR/boundary.geojson',grid400Url:'data/countries/TR/grid_400.geojson',grid154Url:'data/countries/TR/grid_154.geojson',substationsUrl:'data/countries/TR/substations.geojson',manifestUrl:'data/countries/TR/manifest.json'
    },
    ES: {
      code:'ES',name:{tr:'İspanya',en:'Spain'},nameTr:'İspanya',timezone:'Europe/Madrid',center:[40.2,-3.7],zoom:6,
      coverageNote:{tr:'İspanya ana karası ve Balear Adaları; Kanarya Adaları kapsam dışıdır',en:'Mainland Spain and the Balearic Islands; the Canary Islands are outside coverage'},boundaryUrl:'data/countries/ES/boundary.geojson',grid400Url:'data/countries/ES/grid_400.geojson',grid154Url:'data/countries/ES/grid_154.geojson',substationsUrl:'data/countries/ES/substations.geojson',manifestUrl:'data/countries/ES/manifest.json'
    },
    FR: {
      code:'FR',name:{tr:'Fransa',en:'France'},nameTr:'Fransa',timezone:'Europe/Paris',center:[46.5,2.2],zoom:6,
      coverageNote:{tr:'Metropolitan Fransa ve Korsika; denizaşırı bölgeler kapsam dışıdır',en:'Metropolitan France and Corsica; overseas regions are outside coverage'},boundaryUrl:'data/countries/FR/boundary.geojson',grid400Url:'data/countries/FR/grid_400.geojson',grid154Url:'data/countries/FR/grid_154.geojson',substationsUrl:'data/countries/FR/substations.geojson',manifestUrl:'data/countries/FR/manifest.json'
    },
    PT: {
      code:'PT',name:{tr:'Portekiz',en:'Portugal'},nameTr:'Portekiz',timezone:'Europe/Lisbon',geocodeCountryCode:'pt',center:[39.6,-8.0],zoom:6,
      coverageNote:{tr:'Portekiz ana karası; Azorlar ve Madeira kapsam dışıdır',en:'Mainland Portugal; the Azores and Madeira are outside coverage'},boundaryUrl:'data/countries/PT/boundary.geojson',grid400Url:'data/countries/PT/grid_400.geojson',grid154Url:'data/countries/PT/grid_154.geojson',substationsUrl:'data/countries/PT/substations.geojson',manifestUrl:'data/countries/PT/manifest.json'
    },
    IT: {
      code:'IT',name:{tr:'İtalya',en:'Italy'},nameTr:'İtalya',timezone:'Europe/Rome',geocodeCountryCode:'it',center:[42.5,12.5],zoom:6,
      coverageNote:{tr:'İtalya ana karası, Sicilya ve Sardinya',en:'Mainland Italy, Sicily and Sardinia'},boundaryUrl:'data/countries/IT/boundary.geojson',grid400Url:'data/countries/IT/grid_400.geojson',grid154Url:'data/countries/IT/grid_154.geojson',substationsUrl:'data/countries/IT/substations.geojson',manifestUrl:'data/countries/IT/manifest.json'
    }
  };
  A.activeCountry=()=>A.COUNTRIES[A.CONFIG.activeCountryCode]||A.COUNTRIES.TR;
  A.applyCountryConfig=(code,boundary)=>{
    const country=A.COUNTRIES[code]||A.COUNTRIES.TR,feature=boundary?.features?.[0],geometry=feature?.geometry||null;
    const positions=[];const walk=v=>{if(Array.isArray(v)&&v.length>=2&&Number.isFinite(Number(v[0]))&&Number.isFinite(Number(v[1])))positions.push([Number(v[0]),Number(v[1])]);else if(Array.isArray(v))v.forEach(walk);};walk(geometry?.coordinates);
    A.CONFIG.activeCountryCode=country.code;A.CONFIG.defaultCenter=country.center;A.CONFIG.defaultZoom=country.zoom;A.CONFIG.regionLabel=A.I18n?.countryName(country.code)||country.nameTr;A.CONFIG.regionGeometry=geometry;
    if(positions.length){const xs=positions.map(p=>p[0]),ys=positions.map(p=>p[1]);A.CONFIG.regionBounds={west:Math.min(...xs),south:Math.min(...ys),east:Math.max(...xs),north:Math.max(...ys)};}
    A.CONFIG.gridSources['400'].file=country.grid400Url;A.CONFIG.gridSources['154'].file=country.grid154Url;A.CONFIG.gridSources.substations.file=country.substationsUrl;
    A.CONFIG.mtgGeoColourWms.probeBbox=[A.CONFIG.regionBounds.south,A.CONFIG.regionBounds.west,A.CONFIG.regionBounds.north,A.CONFIG.regionBounds.east].join(',');
    return country;
  };
})(window.AtmoApp);
