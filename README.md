# Türkiye Wildfire Grid Risk Monitor

> **Sürüm:** v3.4.4 · **Canlı:** <https://murathany90.github.io/tr_wildfire/> · **Harita serbesttir; veri Türkiye ile sınırlıdır.**

## Proje Özeti

Türkiye Wildfire Grid Risk Monitor, aktif orman yangınlarının elektrik iletim şebekesi üzerindeki etkisini operasyonel olarak izlemek için geliştirilmiş bir web uygulamasıdır. NASA FIRMS termal tespitlerini, gerçek uydu görüntüsünü (EUMETSAT MTG-I GeoColour), yangın kaynaklı PM10 model bileşenini (CAMS), rüzgârı (Open-Meteo), EFFIS yangın tehlike indeksi ve yanmış alan doğrulama katmanlarını ve OpenStreetMap kaynaklı iletim şebekesi verisini tek haritada birleştirir; hangi yangın olaylarının önce inceleneceğine öncelik veren bir risk analizi sunar.

Uygulama **GitHub Pages üzerinde statik olarak** yayınlanır: tarayıcıda çalışan saf ön yüz (HTML/CSS/JS) + `data/` içindeki statik GeoJSON şebeke dosyaları. Yerel geliştirme için opsiyonel bir Node.js yardımcı sunucusu (`server.mjs`) sağlanır.

Tüm veri katmanları yalnızca Türkiye operasyonel alanı (yaklaşık 25.6°–44.9° D, 35.8°–42.2° K) içinde sorgulanır; harita görünümü serbesttir.

## Temel Özellikler

- **NASA FIRMS Multi-VIIRS aktif yangın tespitleri** — AUTO modunda NOAA-21, NOAA-20 ve Suomi-NPP paralel sorgulanır; aynı yangını birden çok uydudan saymamak için dedupe uygulanır. İsteğe bağlı MODIS kaynağı da desteklenir.
- **FRP (Yangın Radyatif Gücü) filtresi** — varsayılan eşik **≥ 30 MW**; slider 0–200 MW arası ayarlanabilir. Eşik tek kaynaktan gelir (`config.js` → `frpThreshold`); state, slider ve sıfırlama aynı değeri kullanır.
- **FireEvent clustering** — 5 km / 6 saat uzay-zaman kümelemesi; düşük zoom'da olay kümeleri, yakın zoom'da tekil hotspot'lar (altıgen) çizilir. Görünür alan + FRP filtresi sonrası en fazla **5.000 işaretçi** render edilir.
- **Piksel ayak izi (pixel footprint)** — her tespitin scan×track boyutuna göre yangın piksel geometrisi.
- **Tahmini Termal Yayılım** — tespit noktalarından türetilen, yangının olası genişleme alanını gösteren **tahmini** katman.
- **CAMS Wildfire PM10 duman modeli** — Open-Meteo Air Quality API üzerinden CAMS European Air Quality `pm10_wildfires` bileşeni (~11 km çözünürlük, saatlik); toplam PM10 içindeki yangın payı türetilmiş katman olarak ayrıca gösterilir.
- **EUMETSAT MTG-I FCI GeoColour gerçek uydu görüntüsü** — son 48 saat, 10 dakikalık slotlarla tarayıcıdan doğrudan WMS olarak çizilir.
- **MTG timeline senkronu** — son 48 saat zaman çizelgesi; MTG açıkken 10 dakikalık frame/playback hızı.
- **EFFIS Fire Weather Index (FWI)** — Copernicus EFFIS WMS `ecmwf007.fwi` katmanı, zaman çizelgesiyle senkron.
- **EFFIS Yanmış Alanlar (Burnt Area)** — uydu tabanlı NRT doğrulama poligonu (`effis.nrt.ba.poly`), zaman çizelgesiyle senkron; varsayılan AÇIK.
- **Open-Meteo rüzgâr ve meteoroloji** — 10 m / 850 hPa / 700 hPa rüzgâr alanı + geocode.
- **OSM iletim şebekesi** — 400 kV, 154 kV, 20–66 kV ve gerilimi bilinmeyen hat sınıfları + trafo merkezi noktaları.
- **30 km rüzgâr bazlı olası yayılım koridoru** — mevcut rüzgâr alanıyla aşağı-rüzgâr sektör (30 km, ±22°, en çok 30 koridor) taranır; koridor içindeki hatlar ve trafo merkezleri vurgulanır. Varsayılan AÇIK.
- **Trafo merkezi risk analizi** — her yangın olayı için mesafe + FRP + tespit yaşı + gerilim/önem temelli öncelik skoru; riskli trafo merkezleri ve hat segmentleri haritada işaretlenir, risk tablosu sıralanabilir.
- **Mobil responsive tasarım** — dokunmatik hedefler, kaydırılabilir KPI şeridi, alt sayfa detay paneli; 375 px'ten masaüstüne kadar taşmasız.

## Veri Kaynakları

| Kaynak | Kullanım | Tip | Durum |
|---|---|---|---|
| NASA FIRMS | Aktif termal yangın tespitleri + FRP | Gerçek uydu tespiti | Aktif |
| EUMETSAT MTG-I GeoColour | Gerçek uydu görüntüsü | WMS / gerçek görüntü | Aktif |
| CAMS (via Open-Meteo Air Quality) | Yangın kaynaklı PM10 model bileşeni | Model | Aktif |
| EFFIS FWI | Yangın tehlike indeksi | Model | Aktif |
| EFFIS Burnt Area | Yanmış alan doğrulaması | Uydu tabanlı NRT | Aktif |
| Open-Meteo | Rüzgâr / meteoroloji / geocode | Model / API | Aktif |
| OpenStreetMap | İletim şebekesi (hatlar + TM) | Harita / veri | Aktif |

AtmoHub, AFAD/İhtiyaç Haritası FirePolygon ve GFW kaynakları v3.4'te tamamen kaldırılmıştır; aktif veri kaynağı değildirler ve uygulamada referansları yoktur.

## Gerçek Veri / Model Ayrımı

| Katman | Tür | Açıklama |
|---|---|---|
| NASA FIRMS | **Gerçek / gözlemsel** | Uydu termal anomali tespiti; hotspot yangın perimetresi değildir |
| MTG GeoColour | **Gerçek / gözlemsel** | Gerçek uydu görüntüsü (RGB render); otomatik duman/aktif yangın tespiti yapmaz |
| EFFIS Burnt Area | **Gerçek / gözlemsel** | Uydu tabanlı NRT algoritmik poligon; resmî saha perimetresi değildir |
| CAMS PM10 | **Model** | Sayısal hava kalitesi model çıktısı; ölçüm değildir |
| Open-Meteo rüzgâr | **Model** | Sayısal hava tahmini modeli |
| EFFIS FWI | **Model** | Meteorolojik yangın tehlike indeksi |
| Rüzgâr bazlı yayılım koridoru | **Model / türetilmiş** | Meteorolojik tarama geometrisi; duman yörüngesi veya tahmin ürünü değildir |
| Tahmini termal yayılım | **Model / türetilmiş** | Tespit noktalarından türetilmiş olası genişleme alanı; resmî yangın perimetresi veya tahmin ürünü değildir |

> **Önemli:** "Tahmini Termal Yayılım" ve "Rüzgâr Bazlı Yayılım Koridoru" resmî yangın perimetresi veya tahmin ürünü değildir. Operasyonel taramayı destekleyen kartografik yardımcılardır.

## Katmanlar

Varsayılan durumlar `js/config.js` ve `js/app.js` state'inden gelir (kullanıcı tercihleri localStorage'da kayıtlıysa o tercihler korunur):

| Katman | Varsayılan |
|---|---|
| Rüzgâr (10 m / 850 hPa / 700 hPa) | ✅ Açık |
| FIRMS yangın tespitleri | ✅ Açık |
| Öncelik halkaları + riskli varlık vurgusu | ✅ Açık |
| Şebeke çekirdeği (400/154 kV + TM) | ✅ Açık |
| Tahmini termal yayılım | ✅ Açık |
| EFFIS Yanmış Alanlar — DOĞRULAMA | ✅ Açık |
| Rüzgâr bazlı yayılım koridoru | ✅ Açık |
| MTG GeoColour uydu görüntüsü | ⬜ Kapalı (kullanıcı açmalı) |
| EFFIS FWI | ⬜ Kapalı |
| FRP yoğunluğu | ⬜ Kapalı |
| Piksel ayak izi / olay evrim izi | ⬜ Kapalı |
| Duman izi (smoke points) | ⬜ Kapalı |

## MTG GeoColour

- **Resmî endpoint:** `https://view.eumetsat.int/geoserver/wms`
- **WMS sürümü:** 1.3.0 (GetCapabilities ile doğrulanmış), EPSG:4326 (lat,lon eksen sırası), PNG
- **Katman:** `mtg_fd:rgb_geocolour` — MTG-I FCI GeoColour RGB gerçek görüntü
- **Zaman aralığı:** son 48 saat (10 dakikalık slotlar)
- **Frame backfill:** bir frame tamamen başarısız olursa en fazla 12 slot (10 dk) geriye gidilir; başarılı bir tile içeren frame "OK" sayılır
- **Future timeline clamp:** gelecekteki zaman çizelgesi konumlarında MTG son mevcut gerçek frame'e kenetlenir; asla gelecek slota yuvarlama yapılmaz
- **İstenen vs gösterilen:** lejant, kullanıcının seçtiği zaman ("Seçilen") ile ekrandaki gerçek frame'i ("Uydu karesi") ayrı gösterir
- **Playback:** MTG açıkken oynatım 10 dk/frame; opaklık varsayılan %85 (kaydırıcı ile ayarlanır)

MTG GeoColour **tek başına duman tespiti değildir** — görsel doğrulama ve bağlam amaçlı gerçek görüntüdür; bulut/duman ayrımı otomatik yapılmaz.

## Şebeke Risk Analizi

- Her yangın olayı için 1 / 3 / 10 / 25 km öncelik halkaları ve olay başına öncelik skoru hesaplanır.
- Risk skoru: olay–şebeke mesafesi + FRP + tespit yaşı + gerilim/TM önemi; rüzgâr verisi varsa doğrultu katkısı eklenir.
- Riskli trafo merkezleri **10×10 px, siyah dolgu (`#000`) + mavi 2 px dış çizgi (`#2f80ff`)** karelerle gösterilir — **tüm risk seviyelerinde aynı sembol boyutu ve stil** kullanılır; seviye bilgisi risk tablosu, halkalar ve tooltip'ten okunur.
- Aşağı-rüzgâr koridorunda kalan hat segmentleri (mavi kesikli) ve trafo merkezleri (aynı kare sembol) vurgulanır.
- Etki analizi sekmesinde sıralanabilir risk tablosu; bir satıra tıklayınca ilgili varlık haritada gösterilir.
- Hat/TM kesişim mantığı: olaydan koridor içinde kalan hat parçaları ve TM'ler `insideRegion` filtresiyle Türkiye sınırı içinde sınırlanır.

## FIRMS

- **AUTO Multi-VIIRS:** NOAA-21, NOAA-20, Suomi-NPP NRT kaynakları paralel sorgulanır; aynı olayın birden çok uydudan tespiti `detectionIdentityKey` ile tekleştirilir (aynı zaman + konum + ürün aynı sayılır; farklı ürün/uydular ayrı gözlemdir).
- **İsteğe bağlı kaynak:** `MODIS_NRT` dahil dört kaynak tek tek seçilebilir.
- **Clustering:** 5 km / 6 saat uzay-zaman kümesi → "yangın olayı"; olay kaynak dağılımı (hangi uydular/ürünler katkıda bulundu) gösterilir.
- **FRP filtresi:** varsayılan **≥ 30 MW**; 0 MW = tüm tespitler. Slider 0–200 MW.
- **Render limitleri:** görünür alan filtresi + FRP filtresi + FRP'ye göre sıralama sonrası en fazla **5.000 işaretçi**; olay kümeleri düşük zoom'da özetlenir.
- Tespit sembolleri yaşa göre soluklaşır ve FRP ile boyutlanır; tooltip FRP, ürün ve algılanma zamanını gösterir.

## Teknik Mimari

```
index.html                  Uygulama kabuğu (paneller, katmanlar, timeline)
css/styles.css              Tüm stiller (mobile + masaüstü, tek dosya)
js/
  config.js                 Tüm sabitler: kaynaklar, eşikler, timeline, risk bandları
  utils.js                  Normalizasyon, dedupe, format, fetch yardımcıları
  api.js                    Veri katmanları (FIRMS, CAMS/Open-Meteo, EFFIS, MTG)
  grid.js                   Şebeke veri yükleme + JS fallback (file:// modu)
  map.js                    Leaflet harita, katmanlar, MTG frame yöneticisi, risk sembolleri
  ui.js                     Tablo/panel/KPI/lejant render, service monitor
  app.js                    Uygulama state'i, init, zaman çizelgesi, kullanıcı akışı
  export.js                 CSV/GeoJSON dışa aktarım
data/
  grid_400.geojson          OSM 400 kV sınıfı hatlar (ve .js fallback kopyası)
  grid_154.geojson          OSM 154 kV sınıfı hatlar (ve .js fallback kopyası)
  grid_33.geojson           20–66 kV hatlar (ve .js fallback kopyası)
  grid_unknown.geojson      Gerilimi bilinmeyen hatlar (ve .js fallback kopyası)
  substations.geojson       Trafo merkezleri (ve .js fallback kopyası)
server.mjs                  Yalnız yerel geliştirme: statik servis + FIRMS/tile proxy + /api/health
tests.mjs                   Bağımsız regression test paketi (Node, ağ gerektirmez)
tools/build_grid_from_osm.py  OSM Power Grid export'undan data/ dosyalarını yeniden üretir
.github/workflows/pages.yml GitHub Pages deploy workflow'u
```

**GitHub Pages statik deploy'dur:** tarayıcıya yalnız `index.html`, `css/`, `js/`, `data/` ve `.nojekyll` gider. `server.mjs`, `tests.mjs`, `tools/` ve dokümantasyon Pages artefaktına dahil edilmez. `server.mjs` yalnız yerel geliştirme içindir: statik dosya servisi, FIRMS proxy (MAP_KEY ile), tile proxy ve `/api/health` uç noktalarını sunar; AtmoHub/GFW gibi kaldırılmış kaynaklardan kalıntı route içermez.

Çalışma modu tespiti: `file://` → DOSYA MODU, `localhost`/`127.0.0.1` → SUNUCU MODU, GitHub Pages → GITHUB PAGES, diğer HTTPS → WEB MODU. DOSYA MODU'nda şebeke GeoJSON'ları `.js` fallback dosyalarından yüklenir; FIRMS Node proxy çalışmaz, MTG/EFFIS uydu katmanları doğrudan tarayıcıdan WMS'e gider.

## FIRMS MAP_KEY

NASA FIRMS Area API için bir MAP_KEY gerekir. Anahtar hiçbir zaman repoya yazılmaz:

- **GitHub Pages:** `FIRMS_MAP_KEY` repository secret'ı olarak tanımlanır; Pages workflow'u build sırasında `js/config.js` içindeki `__FIRMS_MAP_KEY__` placeholder'ını secret değeriyle değiştirir.
- **Yerel sunucu:** `FIRMS_MAP_KEY` ortam değişkeni olarak verilir (`start_windows.bat` / `start_linux_mac.sh` anahtarı sorar) ve `server.mjs` proxy'si kullanır.
- Anahtar verilmezse uygulama MTG/EFFIS uydu katmanları, CAMS/Open-Meteo, rüzgâr ve OSM şebekesiyle çalışmaya devam eder; yalnız FIRMS tespitleri yüklenmez.

## Kurulum

Gereksinim: **Node.js 18+** (yalnız yerel sunucu ve testler için; Pages tarafında derleme yoktur).

```bash
git clone https://github.com/murathany90/tr_wildfire.git
cd tr_wildfire
npm install        # bağımlılık yoktur; paket kurulumunu onaylar
npm test           # regression testleri (tests.mjs)
npm start          # yerel sunucu: http://127.0.0.1:8890 (doluysa sıradaki port)
```

Alternatif başlatma:

- **Windows:** `start_windows.bat` (FIRMS_MAP_KEY sorar, tarayıcıyı sunucu açıldıktan sonra açar)
- **Linux/macOS:** `FIRMS_MAP_KEY=... ./start_linux_mac.sh`
- `index.html`'i doğrudan tarayıcıda açmak da mümkündür (DOSYA MODU; FIRMS proxy'si hariç tüm statik katmanlar çalışır).

`server.mjs` varsayılan port 8890'dır; doluysa sıradaki boş portu seçer ve gerçek adresi yazdırır.

## Test

Bağımsız regression paketi `tests.mjs` (Node, ağ gerekmez; tek istisna canlı EUMETView contract testidir — ağ yoksa SKIPPED):

```bash
npm test
```

Mevcut durum: **116/116 test geçti** (v3.4.4 itibarıyla). Paket; FRP filtresi, clustering, dedupe, MTG frame/backfill davranışı, varsayılan katmanlar, risk sembolleri, risk özeti paneli, CSS mobil düzeni, sürüm tutarlılığı ve kaldırılan kaynakların kalıntılarının olmadığını (AtmoHub/GFW/FirePolygon yokluk assertion'ları) doğrular.

## GitHub Pages Deploy

`.github/workflows/pages.yml` workflow'u `master` branch'ine her push'ta çalışır (`workflow_dispatch` ile manuel de tetiklenebilir):

1. **Master push** → workflow başlar (permissions: `pages: write`, `id-token: write`).
2. **FIRMS secret injection:** `sed` ile `js/config.js` içindeki `__FIRMS_MAP_KEY__` placeholder'ı `secrets.FIRMS_MAP_KEY` değeriyle değiştirilir.
3. **Staging:** yalnızca runtime dosyaları `deploy/` klasörüne kopyalanır — `index.html`, `css/`, `js/`, `data/`, `.nojekyll`. README, testler, sunucu ve araçlar artefakta girmez.
4. **Artefakt yükleme:** `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4` ile yayınlanır.

## Bilinen Sınırlamalar

- MTG GeoColour gerçek görüntüsünde bulut/duman ayrımı otomatik değildir; katman görsel doğrulama amaçlıdır.
- CAMS PM10 ve Open-Meteo rüzgârı model çıktısıdır; ölçüm değildir.
- EFFIS Burnt Area resmî saha perimetresi değildir (algoritmik NRT ürünü).
- Rüzgâr bazlı yayılım koridoru meteorolojik tarama geometrisidir; duman yörüngesi veya tahmin ürünü değildir.
- FIRMS hotspot'u yangın perimetresi değildir; FRP yanmış alan değildir.
- Risk skoru arıza olasılığı veya resmî güvenlik mesafesi değildir.
- Harita karar destek amaçlıdır; resmî acil durum, SCADA/EMS veya şebeke işletme karar sistemi değildir.
- FIRMS tespitleri MAP_KEY gerektirir; anahtar olmadan yalnız tespit katmanı eksik kalır.

## Sürüm Geçmişi

- **v3.4.4** — ⚡ Şebeke Risk Özeti paneli: lejant toggle'ının altına bağımsız "Analizi Göster/Gizle" butonu; en yüksek öncelikli 5 yangın olayı kartı (risk bandı, en yakın hat/TM + mesafe, FRP, rüzgâr koridoru, risk skoru). Tablo ile aynı veri kaynağı/sıralama; kart tıklaması haritayı olaya odaklar; canlı güncelleme; mobil sınırlar.
- **v3.4.3** — Varsayılan katman ve sembol düzeltmeleri: FRP varsayılanı 30 MW (tek kaynak), termal yayılım/EFFIS BA/koridor varsayılan açık, tüm TM risk kareleri tek tip (10×10, siyah + mavi çerçeve).
- **v3.4.2** — MTG hotfix: kullanıcı zamanı seçiminde backfill bütçesi sıfırlanır; MTG metinlerinde tekrarlanan UTC eki kaldırıldı.
- **v3.4.1** — MTG resmî EUMETView endpoint'i, slot floor + gelecek clamp, frame-bazlı backfill (max 12), istenen/gösterilen frame ayrımı, MTG'de 10 dk playback, riskli TM kare sembolleri, service monitor durumları.
- **v3.4.0** — MTG-I FCI GeoColour gerçek uydu görüntüsü eklendi; AtmoHub, AFAD/İhtiyaç Haritası FirePolygon ve GFW tamamen kaldırıldı; EFFIS Burnt Area birincil doğrulama poligonu yapıldı; koridor 30 km'ye daraltıldı.

Ayrıntılı geliştirme kaydı için `GELISTIRMELER.md`'ye bakınız.
