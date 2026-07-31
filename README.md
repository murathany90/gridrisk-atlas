# Türkiye Wildfire Grid Risk Monitor v3.4.1

> **Harita serbesttir; veri Türkiye ile sınırlıdır.** GitHub Pages'te GITHUB PAGES modunda çalışır.


- **v3.4.1** MTG GeoColour resmi EUMETView endpoint'ine taşındı (`view.eumetsat.int/geoserver/wms`, WMS 1.3.0), zaman slotu floor + gelecek-clamp (gelecek frame üretilmez), frame-bazlı backfill (tile değil frame; en çok 12 slot), gösterilen vs istenen frame zamanı ayrımı, MTG açıkken 10 dk playback, riskli trafo merkezleri kare sembollerle, service monitor yeni durumları (loading/backfill/no-frame/Geçersiz WMS yanıtı).
- **v3.4** EUMETSAT MTG-I FCI **GeoColour gerçek uydu görüntüsü** (WMS, 10 dk slot, timeline senkronu) eklendi; AtmoHub, AFAD/İhtiyaç Haritası FirePolygon, GFW ve eski MTG active-fire adapter'ları tamamen kaldırıldı. EFFIS Burnt Area birincil doğrulama poligonu yapıldı.
- **v3.3** Multi-source fire data fusion: AUTO Multi-VIIRS (NOAA-21/NOAA-20/S-NPP paralel + dedup), pixel footprint, thermal envelope, event evolution trail, EFFIS Burnt Area WMS.
- Runtime mode detection: `file:` → DOSYA MODU, `localhost`/`127.0.0.1` → SUNUCU MODU, GitHub Pages → GITHUB PAGES, diğer HTTPS → WEB MODU.
- `index.html` doğrudan (`file://`) açıldığında şebeke GeoJSON'ları `.js` fallback dosyalarından yüklenir. Bu modda FIRMS Node proxy çalışmaz; MTG/EFFIS uydu katmanları doğrudan tarayıcıdan EUMETSAT WMS'e gider.

# Türkiye Wildfire Grid Risk Monitor v3.4.1

Türkiye içindeki orman yangını termal tespitlerini, yangın kaynaklı yüzey PM10 model bileşenini, rüzgârı, EFFIS Fire Weather Index ve Burnt Area katmanlarını, EUMETSAT MTG-I GeoColour gerçek uydu görüntüsünü ve kullanıcı tarafından sağlanan OpenStreetMap iletim şebekesi verisini aynı haritada birleştiren yerel web uygulaması.

## Ana amaç

Genel hava kalitesi izlemek yerine şu operasyonel sorulara odaklanır:

- Son 24 saatte kaç ayrı **yangın olayı kümesi** var?
- Hangi kümeler 400/154 kV iletim hatlarına veya trafo merkezlerine yaklaşıyor?
- Yangın kaynaklı PM10 model bileşeni hangi bölgelerde yükseliyor?
- Rüzgâr alanının aşağı-rüzgâr tarafında hangi şebeke koridorları izlenmeli?
- Gerçek uydu görüntüsü (MTG GeoColour) ne gösteriyor?
- Hangi olaylar önce incelenmeli?

## v3.4.1 değişiklikleri

- **MTG WMS endpoint düzeltmesi**: eski EUMETView GeoServer URL'i (SPA HTML döndürüyordu) yerine resmi **`view.eumetsat.int/geoserver/wms`**; GetCapabilities ile doğrulanan **WMS 1.3.0** + EPSG:4326 (lat,lon eksen sırası). `srs` parametresi kaldırıldı.
- **Zaman slotu**: `Math.round` → `Math.floor` (asla gelecek slota yuvarlamaz; 12:56 → 12:50). Gelecekteki timeline konumlarında MTG **son mevcut gerçek frame'e** kenetlenir.
- **Frame-bazlı backfill** (`MtgFrameManager`): tile yerine frame düzeyinde çalışır — bir frame'de en az 1 başarılı tile → OK; tamamen başarısız → 10 dk geri, en çok 12 slot. `frameSeq` damgası sayesinde eski frame'in geç tile hataları yeni frame'i etkilemez. HTML/SPA yanıtı probe ile tespit edilir → **"Geçersiz WMS yanıtı"**.
- **Gösterilen zaman ayrımı**: `mtgRequestedTime` (kullanıcı seçimi) ile `mtgDisplayedTime` (ekrandaki gerçek frame) ayrı; lejant "Seçilen: 14:30 UTC / Uydu karesi: 14:10 UTC" formatında.
- **MTG 10 dk playback**: MTG açıkken oynatım 10 dk/frame (`mtgPlayStepMinutes: 10`), kapalıyken 3 saat; 200 ms debounce, WMS katmanı reuse.
- **Riskli trafo merkezleri kare**: `setFireImpacts` en yakın TM ve aşağı-rüzgâr koridoru TM'leri kare semboller (kritik 14 / yüksek 12 / orta 10 / izleme 8 px, risk renginde); hat gösterimi değişmedi; lejantlarda kare TM örnekleri.
- **Service monitor**: `loading` (Yükleniyor), `ok` (Bağlı), `backfill` (Gecikmeli frame), `no-frame` (Kare yok), `error` (Hata) durumları ayrıştırıldı.
- Testler **101/101** (canlı EUMETView contract testi dahil — GetCapabilities + GetMap image/png PNG doğrulaması; ağ yoksa SKIPPED).

## v3.4 değişiklikleri

- **EUMETSAT MTG-I FCI GeoColour RGB** gerçek uydu görüntüsü katmanı eklendi (doğrudan tarayıcıdan `view.eumetsat.int/geoserver/wms` WMS 1.3.0, EPSG:4326, PNG). 10 dakikalık slotlara hizalanır; zaman çizelgesi oynatımıyla senkron çalışır; 200 ms debounce ile `TIME` parametresi güncellenir. `mtgOpacity` kaydırıcısı %30–100 arası opaklık verir (varsayılan %85).
- **Kaldırılan kaynaklar**: AtmoHub (portal/bundle keşfi + SSRF korumalı proxy), AFAD/İhtiyaç Haritası FirePolygon adapter'ı (lastGood/roll-cache/pagination), GFW Integrated Disturbance Alerts, eski EUMETSAT MTG active-fire adapter'ı + `/api/mtg/active_fires` proxy'si. İlgili ayar kartları, service monitor satırları, kontroller ve API anahtarı yapılandırmaları temizlendi.
- **EFFIS Burnt Area** birincil doğrulama poligonu yapıldı (`effis.nrt.ba.poly` WMS); varsayılan kapalı, zaman çizelgesiyle senkron, "algoritmik ürün — resmî saha perimetresi değildir" uyarılı.
- **Trafo merkezleri** artık gerilime göre boyutlandırılmış **kare** işaretçilerle çizilir (8/10/12/14 px; 66/154/300 kV eşikleri; düşük/orta/yüksek/kritik renkler).
- Rüzgâr bazlı izleme koridoru 50 km → **30 km** daraltıldı (`downwindMaxDistanceKm`, ±22°, en çok 30 koridor).
- Katman paneli yeniden düzenlendi: **🛰 Uydu ve Duman** (MTG GeoColour, CAMS PM10 modeli, Rüzgâr, Koridor) ve **🔥 Yangın / Doğrulama** (FIRMS, EFFIS Yanmış Alan) grupları.
- Service monitor sadeleştirildi: basemap, FIRMS, CAMS/Open-Meteo, EFFIS FWI, EFFIS Burnt Area, EUMETSAT MTG GeoColour, şebeke, geocode.

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

FIRMS aktif termal tespitleri için MAP_KEY gerekir. BAT başlangıcında anahtarı girebilirsiniz. Anahtar verilmezse uygulama MTG/EFFIS uydu katmanları, CAMS/Open-Meteo, rüzgâr ve yerel OSM şebeke katmanlarıyla çalışmaya devam eder.

Tarayıcıya anahtar gömmemek için önerilen akış:

```text
BAT → FIRMS_MAP_KEY ortam değişkeni → server.mjs → NASA FIRMS
```

## Gerçek veri kaynakları

| Veri | Kaynak | Kullanım |
|---|---|---|
| Termal tespit / FRP | NASA FIRMS Area API | Türkiye bbox, MAP_KEY gerekli |
| Gerçek uydu görüntüsü | EUMETSAT MTG-I FCI GeoColour WMS | `mtg_fd:rgb_geocolour`, 10 dk slot, doğrudan tarayıcı |
| Yangın poligonu / yanmış alan | Copernicus EFFIS/GWIS WMS | `effis.nrt.ba.poly`, TIME parametresi |
| Yangın kaynaklı PM10 | CAMS Europe via Open-Meteo Air Quality | `pm10_wildfires`, yüzeye yakın |
| Wildfire PM10 payı | CAMS wildfire PM10 / toplam CAMS PM10 | Uygulamada türetilir |
| Rüzgâr | Open-Meteo Weather | 10 m / 850 hPa / 700 hPa |
| FWI | Copernicus EFFIS WMS | `ecmwf007.fwi`, TIME parametresi |
| İletim şebekesi | Kullanıcının OSM Power Grid GeoJSON'u | 400/154 kV + TM core |

## Harita altlıkları ve lisans

- OpenStreetMap Standard — © OpenStreetMap contributors. OSM tile kullanım politikasına uyulmalıdır; bulk/offline tile indirme yapılmaz.
- Esri World Imagery — Esri/imagery sağlayıcı attribution'ı haritada gösterilir.
- CARTO Positron / Dark Matter — © OpenStreetMap contributors © CARTO.
- OpenTopoMap — © OpenStreetMap contributors, SRTM; © OpenTopoMap CC-BY-SA.
- MTG GeoColour uydu görüntüleri — © EUMETSAT 2026, haritada attribution olarak gösterilir.

## Bilimsel sınırlar

```text
FIRMS hotspot ≠ yangın perimetresi
MTG GeoColour ≠ termal/aktif yangın detektörü (görsel doğrulama)
EFFIS Burnt Area ≠ resmî saha perimetresi (algoritmik NRT ürünü)
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
