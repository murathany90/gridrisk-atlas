# Türkiye Wildfire Grid Risk Monitor v3.3.1

> **Harita serbesttir; veri Türkiye ile sınırlıdır.** GitHub Pages'te GITHUB PAGES modunda çalışır.


- **v3.3** Multi-source fire data fusion: AUTO Multi-VIIRS (NOAA-21/NOAA-20/S-NPP paralel + dedup), pixel footprint, thermal envelope, event evolution trail, EFFIS Burnt Area WMS, FirePolygon range-aware cache (1/3/7/30 gün).
- GFW Integrated Disturbance Alerts ve EUMETSAT MTG adapter'ları (feature-flagged, credentials gerektirir).
- Runtime mode detection: `file:` → DOSYA MODU, `localhost`/`127.0.0.1` → SUNUCU MODU, GitHub Pages → GITHUB PAGES, diğer HTTPS → WEB MODU.
- `index.html` doğrudan (`file://`) açıldığında şebeke GeoJSON'ları `.js` fallback dosyalarından yüklenir. Bu modda AtmoHub keşif proxy'si ve FIRMS Node proxy çalışmaz.

# Türkiye Wildfire Grid Risk Monitor v3.3.1

Türkiye içindeki orman yangını termal tespitlerini, yangın kaynaklı yüzey PM10 model bileşenini, rüzgârı, EFFIS Fire Weather Index katmanını ve kullanıcı tarafından sağlanan OpenStreetMap iletim şebekesi verisini aynı haritada birleştiren yerel web uygulaması.

## Ana amaç

Genel hava kalitesi izlemek yerine şu operasyonel sorulara odaklanır:

- Son 24 saatte kaç ayrı **yangın olayı kümesi** var?
- Hangi kümeler 400/154 kV iletim hatlarına veya trafo merkezlerine yaklaşıyor?
- Yangın kaynaklı PM10 model bileşeni hangi bölgelerde yükseliyor?
- Rüzgâr alanının aşağı-rüzgâr tarafında hangi şebeke koridorları izlenmeli?
- Hangi olaylar önce incelenmeli?

## v3 değişiklikleri

- Genel PM2.5 / PM10 / European AQI katmanları kaldırıldı. Toplam PM10 yalnız `pm10_wildfires / pm10` oranını hesaplamak için dahili olarak kullanılır.
- `PM10 caused by wildfires` haritada AtmoHub benzeri **yarı saydam sürekli plume** görünümüyle çizilir.
- Plume yalnız görsel interpolasyondur; CAMS Europe modelinin yaklaşık 11 km bilimsel çözünürlüğünü artırmaz.
- Genel PM2.5 / PM10 / AQI ve yangına özgü olmayan AOD görselleştirmeleri kaldırıldı; operasyonel haritada yalnız wildfire PM10 ve bundan türetilen wildfire PM10 payı kullanılır.
- Harita altlıkları: Esri World Imagery, OSM Standard, CARTO Positron, CARTO Dark Matter, OpenTopoMap.
- Lejantların tamamı tek düğmeyle gizlenebilir; her lejant ayrı ayrı kapatılabilir.
- FIRMS noktaları 5 km / 6 saat uzamsal-zamansal kümelerle **yangın olayı** haline getirilir. Zoom ≥9'da ham hotspotlar gösterilir.
- Hotspot yaşına göre opacity azaltılır.
- Risk çekirdeği 400/154 kV hatlar + trafo merkezlerini görünürlükten bağımsız indeksler.
- Riskli en yakın hat segmenti / TM haritada kalın glow ile vurgulanır.
- Rüzgâr bazlı 50 km ±22° **izleme koridoru** eklenmiştir. Bu katman gerçek duman yörüngesi değildir.
- Operasyonel öncelik skoru: şebekeye mesafe + maksimum FRP + tespit yaşı + gerilim/TM önemi + mevcutsa rüzgâr doğrultusu.
- FWI WMS sayısal değer sunmadığı için risk skoruna sahte sayısal FWI eklenmez.
- AtmoHub yalnız açık ağ/bundle keşfiyle incelenir; doğrulanmamış endpoint hiçbir zaman veri katmanı olarak kullanılmaz.

## Çalıştırma — Windows

ZIP'i tamamen bir klasöre çıkarın ve:

```text
start_windows.bat
```

dosyasını çalıştırın. Uygulama:

```text
http://localhost:8765
```

adresinde açılır.

Node.js 18+ gereklidir.

### NASA FIRMS

FIRMS aktif termal tespitleri için MAP_KEY gerekir. BAT başlangıcında anahtarı girebilirsiniz. Anahtar verilmezse uygulama CAMS/Open-Meteo, EFFIS, rüzgâr ve yerel OSM şebeke katmanlarıyla çalışmaya devam eder.

Tarayıcıya anahtar gömmemek için önerilen akış:

```text
BAT → FIRMS_MAP_KEY ortam değişkeni → server.mjs → NASA FIRMS
```

## Gerçek veri kaynakları

| Veri | Kaynak | Kullanım |
|---|---|---|
| Termal tespit / FRP | NASA FIRMS Area API | Türkiye bbox, MAP_KEY gerekli |
| Yangın kaynaklı PM10 | CAMS Europe via Open-Meteo Air Quality | `pm10_wildfires`, yüzeye yakın |
| Wildfire PM10 payı | CAMS wildfire PM10 / toplam CAMS PM10 | Uygulamada türetilir |
| Rüzgâr | Open-Meteo Weather | 10 m / 850 hPa / 700 hPa |
| FWI | Copernicus EFFIS WMS | `ecmwf007.fwi`, TIME parametresi |
| İletim şebekesi | Kullanıcının OSM Power Grid GeoJSON'u | 400/154 kV + TM core |
| AtmoHub | Portal/bundle keşfi | Yalnız doğrulanmış public servis bulunursa gelecekte kullanılabilir |

## Harita altlıkları ve lisans

- OpenStreetMap Standard — © OpenStreetMap contributors. OSM tile kullanım politikasına uyulmalıdır; bulk/offline tile indirme yapılmaz.
- Esri World Imagery — Esri/imagery sağlayıcı attribution'ı haritada gösterilir.
- CARTO Positron / Dark Matter — © OpenStreetMap contributors © CARTO.
- OpenTopoMap — © OpenStreetMap contributors, SRTM; © OpenTopoMap CC-BY-SA.

## Bilimsel sınırlar

```text
FIRMS hotspot ≠ yangın perimetresi
FRP ≠ yanmış alan
PM10 wildfire bileşeni ≠ tüm duman kolonunun ölçümü
rüzgâr yönü ≠ duman yörüngesi
FWI ≠ aktif yangın
risk skoru ≠ arıza olasılığı
```

Uygulama bağımsız bir görselleştirme ve operasyonel ön-eleme prototipidir. Resmî acil durum, SCADA/EMS veya şebeke işletme karar sistemi değildir.

## Dosyalar

```text
index.html
css/styles.css
js/
  config.js
  utils.js
  api.js
  grid.js
  map.js
  ui.js
  app.js
  export.js
data/
  grid_400.geojson
  grid_154.geojson
  grid_33.geojson
  grid_unknown.geojson
  substations.geojson
server.mjs
start_windows.bat
start_linux_mac.sh
SOURCE_VERIFICATION.md
```

Mock/demo veri üretilmez. Bir servis başarısız olduğunda boş veri veya açık hata durumu gösterilir.
