const https = require('https');
const probe = (layer) => {
  const url = `https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=${layer}&styles=&crs=EPSG:3857&bbox=3000000,4000000,5000000,5000000&width=256&height=256&format=image/png`;
  https.get(url, (res) => {
    console.log(layer, res.statusCode, res.headers['content-type'], res.headers['content-length'] || 'chunked');
  });
};
probe('mtg_fd:rgb_geocolour');
probe('mtg_fd:rgb_firetemperature');
