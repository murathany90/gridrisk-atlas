# Wildfire Grid Risk Monitor

> Sürüm: **v3.5.0** · Canlı: <https://murathany90.github.io/tr_wildfire/> · Arayüz dili: **Türkçe**

Wildfire Grid Risk Monitor; Türkiye, İspanya ve metropolitan Fransa/Korsika için aktif orman yangınları ile elektrik iletim şebekesi yakınlığını aynı operasyonel ekranda inceleyen statik bir web uygulamasıdır. Genel uygulama adı İngilizcedir; kullanıcı arayüzü bu sürümde yalnız Türkçedir.

## Ülke kapsamı

Header içindeki `Ülke` seçicisi şu veri alanlarını değiştirir:

- **Türkiye (TR):** Türkiye sınırı ve şebekesi, `Europe/Istanbul`.
- **İspanya (ES):** ana kara ve Balear Adaları; Kanarya Adaları kapsam dışıdır, `Europe/Madrid`.
- **Fransa (FR):** metropolitan Fransa ve Korsika; denizaşırı bölgeler kapsam dışıdır, `Europe/Paris`.

Başlangıç ülkesi sırası geçerli `?country=TR|ES|FR` URL parametresi, `selectedCountry` localStorage değeri ve son olarak TR varsayılanıdır. Geçersiz URL kodu TR'ye döner. Seçim sayfa yenilenmeden uygulanır ve URL `history.replaceState` ile güncellenir.

Her ülke gerçek Natural Earth Polygon/MultiPolygon sınırıyla filtrelenir. FIRMS isteği önce sınır bbox'ını kullanır; dönen noktalar daha sonra gerçek ülke geometrisi ve polygon delikleriyle tekrar süzülür. Böylece sınır komşusu tespitleri yanlış ülkeye eklenmez.

## Veri katmanları ve analiz

- NASA FIRMS Multi-VIIRS AUTO: NOAA-21, NOAA-20 ve Suomi-NPP NRT; isteğe bağlı MODIS NRT.
- EUMETSAT MTG-I GeoColour gerçek uydu WMS görüntüsü.
- CAMS Europe / Open-Meteo yangın kaynaklı PM10.
- Open-Meteo 10 m, 850 hPa ve 700 hPa rüzgârı.
- Copernicus EFFIS FWI ve NRT yanmış alan WMS katmanları.
- OpenStreetMap 400/154 kV sınıfı iletim hatları ve trafo merkezleri.
- 5 km/6 saat FIRMS olay kümelemesi, 30 MW varsayılan FRP eşiği.
- Mesafe, FRP, tespit yaşı, şebeke sınıfı/TM önemi ve mevcutsa rüzgâr doğrultusunu kullanan operasyonel öncelik skoru.
- 10 m yüzey rüzgârı ve maksimum FRP ile 10–30 km adaptif aşağı-rüzgâr tarama koridoru.

Risk skoru bir arıza olasılığı, güvenlik mesafesi veya resmî yangın tahmini değildir. FIRMS tespiti yangın perimetresi değildir; CAMS ve Open-Meteo çıktıları model verisidir.

## Şebeke sınıfları

Üç ülke aynı görsel ve risk sınıflarını kullanır:

| Gerçek gerilim | Runtime sınıfı | Harita stili |
|---|---|---|
| 300–550 kV (iki sınır dahil) | `gridClass: "400"` / `400 kV sınıfı` | `#d7191c`, 2.2 px |
| 50–299.999 kV | `gridClass: "154"` / `154 kV sınıfı` | `#111111`, 1.5 px |
| 50 kV altı veya 550 kV üstü | Runtime dışında | Manifestte sayılır |

Gerçek kaynak gerilimi `actualVoltageKv` alanında korunur. Örneğin 225 kV bir hat `154 kV sınıfı` olarak analiz edilir, ancak tooltip'te ayrıca `Gerçek OSM gerilimi: 225 kV` gösterilir.

Trafo merkezleri tüm ülkelerde 10×10 px siyah dolgulu, 2 px mavi çerçeveli karelerdir. TM risk hesabında kalır; yalnız yangına en fazla 5 km uzaklıktaki TM ek risk vurgusu alır. Öncelik tablosu ve ilk beş analiz kartı daima en yakın hattı gösterir, TM'ye görsel fallback yapmaz.

## Ham veri ve preprocessing

Ham import girdileri runtime kaynağı değildir:

- `spain_osm_power_grid_50kv_plus_full.geojson`
- `france_osm_power_grid_50kv_plus_full.geojson`
- `raw/TR/*.geojson`

Üretim komutu:

```powershell
npm run build:grid
```

Yalnız mevcut commitli çıktıları doğrulamak için:

```powershell
npm run validate:grid
```

`tools/build_country_grid.py` şu gerilim alanlarını sırayla okur: geçerli `voltageMaxKv`, `voltagesKv` maksimumu, `voltageRaw`, `voltage`. 10.000 üzeri değerleri volt kabul edip 1000'e böler; noktalı virgül, virgül ve çoklu değerleri destekler; NaN, sıfır ve negatif değerleri reddeder. `line`, `minor_line`, `cable` hat; `substation` TM kabul edilir. MultiLineString parçaları LineString'e normalize edilir.

Üretilen yapı:

```text
data/countries/{TR,ES,FR}/
  boundary.geojson
  grid_400.geojson
  grid_154.geojson
  substations.geojson
  manifest.json
```

Runtime varlıkları ülke önekli benzersiz `assetId` taşır. Nested tags, ArcGIS `OBJECTID` ve yinelenen ham ID alanları yayın çıktısından çıkarılır; ad, operatör, gerçek gerilim ve OpenStreetMap/ODbL kaynak bilgisi korunur.

Fransa ham kaynağının metadata'sı 14 başarısız indirme parçası bildirmektedir. Bu parçaları güvenilir şekilde yeniden üretecek URL/chunk kimliği bulunmadığı için v3.5.0 manifesti `partial: true`, `failedRequests: 14` taşır. Uygulama analiz yapmayı sürdürür ve Ayarlar/Analiz ekranlarında **Kısmi şebeke verisi** uyarısını gösterir; veri tam kabul edilmez.

## Çalıştırma

Node.js 18 veya üstü gerekir:

```powershell
npm start
```

Uygulama varsayılan olarak `http://localhost:8890` adresinde açılır. Yerel FIRMS verisi için `FIRMS_MAP_KEY` ortam değişkeni kullanılabilir; GitHub Pages dağıtımında aynı değer Actions secret'ından `js/config.js` içine enjekte edilir.

## Testler

```powershell
node tests.mjs
npm test
npm run validate:grid
git diff --check
```

Node regresyon paketi ülke registry/öncelik, sınır geometrisi, cache ve stale-response korumaları, saat dilimi, risk/UI sözleşmesi ve Pages staging davranışını kapsar. Python paketi ham sayıları, ülke kodlarını, geometry/asset bütünlüğünü, gerilim sınırlarını, runtime property temizliğini ve Fransa partial metadata'sını doğrular.

## Cache, performans ve dağıtım

Ülkeye bağlı cache anahtarları ülke kodu içerir (`grid:TR:400`, `firms:ES:...`, `weather:FR:...`). Ülke değişiminde devam eden grid/FIRMS/CAMS/Open-Meteo istekleri iptal edilir; sıra ve ülke kodu stale-response guard'ı olarak kontrol edilir. Eski katmanlar, spatial index, risk tablosu ve analiz kartları temizlenir. Yalnız aktif ülkenin üç runtime şebeke dosyası lazy-load edilir; düşük zoomda TM DOM marker sayısı sınırlandırılır ve Leaflet Canvas çizimi korunur.

Pages workflow yalnız `index.html`, `css/`, `js/`, `.nojekyll` ve `data/countries/**` içeriklerini stage eder. Büyük ham root GeoJSON dosyaları artifact'a girmez; deploy sırasında preprocessing çalıştırılmaz.

## Export

CSV, JSON ve GeoJSON adları ülke kodunu taşır:

```text
wildfire-grid-risk_TR_YYYY-MM-DD.csv
wildfire-grid-risk_ES_YYYY-MM-DD.json
wildfire-grid-risk_FR_YYYY-MM-DD.geojson
```

Metadata ve satırlar uygun yerlerde `countryCode`, `countryName`, `assetId`, `gridClass` ve `actualVoltageKv` alanlarını içerir.

## Kaynak ve lisans

Şebeke verisi © OpenStreetMap contributors, **ODbL 1.0** kapsamında kullanılır. Ülke sınırları Natural Earth 1:10m Admin 0 verisidir (public domain). Diğer sağlayıcıların verileri kendi kullanım ve lisans koşullarına tabidir.
