# GridMoni

**Wildfire Intelligence for Power Grids**

> Sürüm: **v3.6.3** · Canlı: <https://murathany90.github.io/tr_wildfire/> · Arayüz dili: **Türkçe**

GridMoni provides wildfire intelligence and power grid risk monitoring for Türkiye, Spain, France, Portugal and Italy.

GridMoni; Türkiye, İspanya, Fransa, Portekiz ve İtalya için aktif orman yangınları ile elektrik iletim şebekesi yakınlığını aynı operasyonel ekranda inceleyen statik bir web uygulamasıdır. Kullanıcı arayüzü bu sürümde yalnız Türkçedir.

## Ülke kapsamı

Header içindeki `Ülke` seçicisi şu veri alanlarını değiştirir:

- **Türkiye (TR):** Türkiye sınırı ve şebekesi, `Europe/Istanbul`.
- **İspanya (ES):** ana kara ve Balear Adaları; Kanarya Adaları kapsam dışıdır, `Europe/Madrid`.
- **Fransa (FR):** metropolitan Fransa ve Korsika; denizaşırı bölgeler kapsam dışıdır, `Europe/Paris`.
- **Portekiz (PT):** Portekiz ana karası; Azorlar ve Madeira kapsam dışıdır, `Europe/Lisbon`.
- **İtalya (IT):** İtalya ana karası, Sicilya ve Sardinya, `Europe/Rome`.

Başlangıç ülkesi sırası geçerli `?country=TR|ES|FR|PT|IT` URL parametresi, `selectedCountry` localStorage değeri ve son olarak TR varsayılanıdır. Geçersiz URL kodu TR'ye döner. Seçim sayfa yenilenmeden uygulanır ve URL `history.replaceState` ile güncellenir.

Her ülke gerçek Polygon/MultiPolygon sınırıyla filtrelenir. TR/ES/FR Natural Earth, PT/IT ise Eurostat/GISCO Countries 2024 sınırlarını kullanır. FIRMS isteği önce sınır bbox'ını kullanır; dönen noktalar daha sonra gerçek ülke geometrisi ve polygon delikleriyle tekrar süzülür. Böylece sınır komşusu tespitleri yanlış ülkeye eklenmez.

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

Beş ülke aynı görsel ve risk sınıflarını kullanır:

| Gerçek gerilim | Runtime sınıfı | Harita stili |
|---|---|---|
| 300–550 kV (iki sınır dahil) | `gridClass: "400"` / `400 kV sınıfı` | `#d7191c`, 2.2 px |
| 50–299.999 kV | `gridClass: "154"` / `154 kV sınıfı` | `#111111`, 1.5 px |
| 50 kV altı veya 550 kV üstü | Runtime dışında | Manifestte sayılır |

Gerçek kaynak gerilimi `actualVoltageKv` alanında korunur. Örneğin 225 kV bir hat `154 kV sınıfı` olarak analiz edilir, ancak tooltip'te ayrıca `Gerçek OSM gerilimi: 225 kV` gösterilir.

Trafo merkezleri tüm ülkelerde 7×7 px siyah dolgulu, 2 px mavi çerçeveli karelerdir ve görsel katman varsayılan olarak kapalıdır. TM risk hesabında kalır; yalnız yangına en fazla 5 km uzaklıktaki TM ek risk vurgusu alır. Öncelik tablosu ve ilk beş analiz kartı daima en yakın hattı gösterir, TM'ye görsel fallback yapmaz.

## Ham veri ve preprocessing

Ham import girdileri runtime kaynağı değildir:

- `spain_osm_power_grid_50kv_plus_full.geojson`
- `france_osm_power_grid_50kv_plus_full.geojson`
- `portugal_osm_power_grid_50kv_plus_full.geojson`
- `italy_osm_power_grid_50kv_plus_full.geojson`
- `raw/TR/*.geojson`

Üretim komutu:

```powershell
npm run build:grid
```

Bu komut ES/FR/PT/IT runtime dosyalarını yeniden üretir; mevcut TR paketi değişmeden kalır. Tek ülke için `--country TR|ES|FR|PT|IT`; grup olarak `ESFR`, `PTIT`, `EU` veya beş ülke için `ALL` kullanılabilir.

Yalnız mevcut commitli çıktıları doğrulamak için:

```powershell
npm run validate:grid
```

`tools/build_country_grid.py`, ham OSM `voltage`/`voltageRaw` alanındaki bütün pozitif tokenları istisnasız 1000'e bölerek kV'ye dönüştürür. Yalnız ham alan yoksa adı açıkça kV belirten `actualVoltagesKv`, `voltagesKv`, `actualVoltageKv` veya `voltageMaxKv` alanları doğrudan kullanılabilir. `line`, `minor_line`, `cable` hat; `substation` TM kabul edilir. MultiLineString hatlar ülke sınırında kesilir; polygon TM geometrileri yüzeyin içinde kalan temsil noktasına dönüştürülür.

Üretilen yapı:

```text
data/countries/{TR,ES,FR,PT,IT}/
  boundary.geojson
  grid_400.geojson
  grid_154.geojson
  substations.geojson
  manifest.json
```

Runtime varlıkları ülke önekli benzersiz `assetId` taşır. Nested tags, ArcGIS `OBJECTID` ve yinelenen ham ID alanları yayın çıktısından çıkarılır; `name`, `ref`, `operator`, gerçek gerilimler, şebeke sınıfı, `displayLabel`, label kaynağı, OSM kimliği/zamanı ve kaynak provenance korunur.

ES/FR/PT/IT indirmeleri ortak, resumable altyapıyı kullanır. ArcGIS OSM Europe hat ve nokta katmanları küçük tile'larla, pagination/object-ID fallback ve hata halinde alt tile bölme ile çekilir. ArcGIS Structures polygon trafo merkezlerini kapsamadığı için yüksek gerilim TM alanları küçük ülke tile'larıyla Overpass üzerinden tamamlanır; bütün feature'lar uygulamanın gerçek MultiPolygon sınırıyla doğrulanır.

```powershell
python py_osm_download/fetch_spain_osm_full.py --country-boundary data/countries/ES/boundary.geojson --output py_osm_download/output/spain_osm_power_grid_50kv_plus_full.geojson --resume
python py_osm_download/fetch_france_osm_full.py --country-boundary data/countries/FR/boundary.geojson --output py_osm_download/output/france_osm_power_grid_50kv_plus_full.geojson --resume
python py_osm_download/fetch_portugal_osm_full.py --country-boundary data/countries/PT/boundary.geojson --output py_osm_download/output/portugal_osm_power_grid_50kv_plus_full.geojson --resume
python py_osm_download/fetch_italy_osm_full.py --country-boundary data/countries/IT/boundary.geojson --output py_osm_download/output/italy_osm_power_grid_50kv_plus_full.geojson --resume
```

`py_osm_download/compare_grid_datasets.py`, mevcut ve yeni adayları feature sayısına göre değil; sınır, gerilim, geometri, tile şeffaflığı ve deterministik deduplication production kapılarına göre karşılaştırır. Makine ve insan okunur sonuçlar `reports/` altında tutulur.

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

Node regresyon paketi ülke registry/öncelik, sınır geometrisi, cache ve stale-response korumaları, saat dilimi, risk/UI sözleşmesi, ≤5 km TM marker kuralı ve Pages staging davranışını kapsar. Python paketi ham OSM voltage birimini, retry/pagination/resume akışını, ülke sınırını, geometry/asset bütünlüğünü, dataset seçim kapılarını ve runtime property temizliğini doğrular.

## Cache, performans ve dağıtım

Ülkeye bağlı cache anahtarları ülke kodu içerir (`grid:TR:400`, `firms:ES:...`, `weather:FR:...`). Ülke değişiminde devam eden grid/FIRMS/CAMS/Open-Meteo istekleri iptal edilir; sıra ve ülke kodu stale-response guard'ı olarak kontrol edilir. Eski katmanlar, spatial index, risk tablosu ve analiz kartları temizlenir. Yalnız aktif ülkenin üç runtime şebeke dosyası lazy-load edilir; düşük zoom TM görünümü dosya sırasına bağlı stride yerine deterministik viewport/piksel-hücresi culling kullanır ve hatlar Leaflet Canvas üzerinde çizilir.

Pages workflow yalnız `index.html`, `css/`, `js/`, `.nojekyll` ve `data/countries/**` içeriklerini stage eder. Büyük ham root GeoJSON dosyaları artifact'a girmez; deploy sırasında preprocessing çalıştırılmaz.

## Export

CSV, JSON ve GeoJSON adları ülke kodunu taşır:

```text
wildfire-grid-risk_TR_YYYY-MM-DD.csv
wildfire-grid-risk_ES_YYYY-MM-DD.json
wildfire-grid-risk_FR_YYYY-MM-DD.geojson
wildfire-grid-risk_PT_YYYY-MM-DD.csv
wildfire-grid-risk_IT_YYYY-MM-DD.json
```

Metadata ve satırlar uygun yerlerde `countryCode`, `countryName`, `assetId`, `gridClass`, `actualVoltageKv` ve `displayLabel` alanlarını içerir.

## Kaynak ve lisans

Şebeke verisi © OpenStreetMap contributors, **ODbL 1.0** kapsamında kullanılır. TR/ES/FR sınırları Natural Earth 1:10m Admin 0 verisidir (public domain). PT/IT sınırları European Commission Eurostat/GISCO Countries 2024 verisidir ve `© EuroGeographics for the administrative boundaries` bildirimiyle kullanılır. Diğer sağlayıcıların verileri kendi kullanım ve lisans koşullarına tabidir.
