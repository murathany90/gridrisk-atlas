# v3.13.0 - 3D Terrain and Fire Grid Contrast
- Real DEM-based 3D terrain with MapLibre GL JS, AWS Terrarium DEM, terrain exaggeration 1.43, and hillshade.
- 2D/3D camera synchronization; grid, fire, substation, risk, MTG GeoColour/Fire Temperature, and VIIRS raster mirroring.
- FIRE mode keeps the 154 kV analysis class white while preserving the 400 kV red class; OSM voltage data is unchanged.
- Lazy MapLibre/DEM loading, WebGL/DEM fallback, repeated-toggle cleanup, and real MapLibre plus AWS DEM acceptance coverage.

# v3.12.1 - MTG Imagery Loading Performance
- MTG GeoColour / Fire Temperature probe-first loading with safe fast first-frame discovery.
- Session timestamp cache, background freshness revalidation, and stale-while-revalidate layer replacement.
- Race/timer cleanup, historical timeline isolation, and cache writes only after a successfully displayed latest frame.
- Opacity/default-zero fixes and language-switch imagery reload prevention.
- Deterministic Desktop/Mobile lifecycle coverage.

# v3.12.0 - Satellite Imagery Panel
- **Sürüm 3.12.0**: Harita ve Uydu paneline LIVE (MTG GeoColour), FIRE (MTG Fire Temperature) ve VIIRS True Color modları eklendi. Tüm paneller ve E2E testleri güncellendi.

# v3.11.2 - EUMETView Coordinate and Metadata Fixes  
- **S�r�m 3.11.2**: package.json, package-lock.json, js/config.js, index.html (pill + cache-buster), server.mjs, README.md, s�r�m ge�mi�i.  
**Testler:** BBOX axis d�zeltmesi, MTG/SLSTR Normalize testleri ve Popup format testleri. Node, Playwright, Python hepsi ge�ti.  
  
# Geliştirme Kaydı — GridRisk Atlas

# v3.11.1 — Termal Kaynak Durumu ve MTG FCI FRP Pilotu

**Branch:** `feature/thermal-source-status-mtg-pilot`

**Amaç:** Termal yangın kaynaklarını tek panelde izlenebilir hale getirmek: kaynak durumu (idle/ok/empty/error/disabled), ham/filtreli/tekilleştirilmiş sayaçlar, MTG-I FCI FRP pilot katmanı (EUMETView WFS) ve ülke değişiminde durum sıfırlama.

**Değişiklikler:**
- **`js/thermal-sources.js`** — termal kaynak durum kaydı (seq korumalı setLoading/setResult/setError), `thermalRows()` tablo modeli; S3A/S3B SLSTR ve MTG FCI FRP adaptörleri (EUMETView WFS, normalize + ülke/konum filtresi + tekilleştirme); metrik sözleşmesi: `rawCount = features.length`, `validCount = normalize + ülke filtresi sonrası`, `deduplicatedCount = tekilleştirme sonrası`; başarılı boş sonuçta bilinen sayaçlar 0, bilinmeyenler null/—; MODIS rolü seçili FIRMS kaynağına göre dinamik ("Ana risk · Manuel kaynak" / "Doğrulama · Manuel seçim").
- **`js/app.js`** — ülke değişiminde S3A/S3B/MTG/multi-sensor durumlarını idle'a çekme; her kaynak için kendi `seq + 1` ile eski istek çakışmasını engelleme; MULTI_SOURCE modunda çoklu sensör olay hesabı.
- **`js/ui.js` / `css/styles.css`** — termal kaynak durum tablosu ve mobil kartlar (durum noktası, sayaçlar, not), destekleyici servisler kartı.
- **`js/map.js`** — SLSTR/MTG/multi-sensor katmanları (`L.CircleMarker`), ülke resetinde katman temizliği.
- **`js/api.js`** — FIRMS ürün durumu (MODIS_NRT dahil), `productMetrics` boş başarıda 0.
- **`js/eumetview-wfs.js` / `tools/probe_eumetview_frp.mjs`** — EUMETView WFS getFeature; probe `numberMatched`/`numberReturned` okuyup `totalMatched` ile `returnedCount`'u ayrı raporlar (count=20 sayfa boyutu toplam tespit olarak sunulmaz).
- **i18n (tr/en)** — termal rol/not/durum anahtarları.
- **Sürüm 3.11.1**: `package.json`, `package-lock.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** v3.11.1 bloğu — adaptör normalizasyonu (S3A/S3B/MTG), raw/valid/dedup metrik sözleşmesi, MODIS dinamik rol + i18n, ülke reseti (idle + per-source seq: 2→3, 7→8, 11→12), boş başarı sayaçları, probe `numberMatched`/`numberReturned`; Playwright e2e: termal kaynak tablosu, servis durumu kartı, MTG'nin FIRMS_ONLY'de kapalı kalması, ülke değişimi reseti, senaryo matrisi (EUMETView/Open-Meteo hermetik). Toplam **94/94** Node test + **28/28** Python test + Playwright **84/84** (Desktop Chrome + Mobile) geçti.

---

# v3.10.0 — İzlenebilir Risk Kanıtı: Hattı Tetikleyen Ham Yangın Tespiti

**Branch:** `feature/traceable-grid-risk-evidence`

**Amaç:** Her riskli hat analizinde "hangi tespit neden risklendi" sorusunu veriyle yanıtlamak — olay kümesinin temsilcisi yerine, hatta en yakın **ham tespit** tetikleyici olarak seçilir ve kanıt nesnesi (algı, mesafe, koordinatlar, seçim kuralı) UI/export haritalarında görünür hale gelir.

**Değişiklikler:**
- **`js/grid.js`** — her riskli hat analizine `evidence` eklendi: `triggerDetectionId` (eksikse kararlı bileşik kimlik `uydu|sensör|ürün|zaman|enlem|boylam`), `triggerSource/Satellite/Instrument/Product`, `triggerDetectedAt`, `triggerFrpMw`, `triggerConfidence`, `triggerDayNight`, `triggerLatitude/Longitude`, `triggerDistanceKm`, `nearestLineLatitude/Longitude`, `eventCenterLatitude/Longitude`, `evidenceCount`, `selectionRule: 'nearest_raw_detection'`. Seçim sırası: hatta en yakın ham tespit → mesafe eşitse yüksek güven → FRP → yeni tespit → kararlı kimlik sıralaması (tam bağ deterministik). `triggerDetectionId` null ise kompozit kimlik türetilir.
- **`js/map.js`** — risk katmanına kanıt çizimi eklendi: tetikleyici tespit (kırmızı içi boş çember), hattaki en yakın nokta (sarı nokta) ve bunları birleştiren altın kesikli bağlantı çizgisi; araç ipucunda tetikleyici kimlik, mesafe, FRP ve seçim kuralı görünür. Risk katmanı kapatılınca kanıt çizimleri de gizlenir.
- **`js/ui.js`** — risk tablosuna "Kanıt / Tetikleyici" sütunu (uydu + FRP) ve `Göster` butonu; detay panelinde "Risk Nedeni" bölümü (algı zamanı, FRP, güven, gece/gündüz, tetikleyici mesafesi, koordinatlar, seçim kuralı, kanıt sayısı). Seçili nokta risk kanıtı taşıyorsa panelden gösterilir; risk katmanı/analiz güncellenince senkron kalır.
- **`js/export.js`** — CSV'ye kanıt sütunları (`triggerDetectionId, triggerSource, triggerSatellite, triggerInstrument, triggerProduct, triggerDetectedAt, triggerFrpMw, triggerConfidence, triggerDayNight, triggerLatitude, triggerLongitude, triggerDistanceKm, nearestLineLatitude, nearestLineLongitude, eventCenterLatitude, eventCenterLongitude, evidenceCount, selectionRule`); JSON dump'a `evidence` nesnesi; GeoJSON riskli hat özelliklerine `evidence.*`.
- **`js/locales/en.js|tr.js`** — yeni anahtarlar: `detail.riskEvidence`, `detail.triggerDistance`, `detail.selectionRule`, `detail.evidenceCount`, `detail.evidenceSpatialFail`, `detail.clusterCenterNote`, `analysis.showEvidence`, `analysis.showEvidenceShort`, `summary.evidence`, risk tablosu kanıt sütun başlığı, map.js araç ipucu/lejant kanıt satırları.
- **`css/styles.css`** — tetikleyici çember, en yakın nokta, bağlantı çizgisi, kanıt sütunu ve `evidenceBtn` stilleri.
- **Sürüm 3.10.0**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs` (3.8.0 geri sürülen APP_VERSION düzeltildi), `README.md`, sürüm geçmişi.

**Testler:** v3.10.0 bloğu — tetikleyici = hatta en yakın ham tespit (yüksek FRP'li uzak tespit değil), mesafe/güven/FRP/zaman/kimlik tie-break zinciri, eksik kimlikte kararlı kompozit kimlik, null FRP/güven kırılmazlığı, bozuk hat geometrisi toleransı, risk skoru formülü değişmezliği (Mugla fixture), kanıtın CSV/JSON/GeoJSON export'larında görünürlüğü, yeni i18n anahtarları; Playwright e2e: mock FIRMS CSV ile hatta yakın tespitin tabloda kanıt sütunu + detay paneli + export sütunları ile yüzeye çıkması. Toplam **85/85** Node test + **28/28** Python test + Playwright **76/76** (Desktop Chrome + Mobile) geçti.

---

# v3.5.0 — Türkiye, İspanya ve Fransa Çok Ülkeli Mimari

**Branch:** `feature/multi-country-tr-es-fr`

**Amaç:** Türkiye merkezli çalışma zamanını TR/ES/FR ülke registry'si, gerçek ülke sınırları, ülke-aware cache/abort/stale guard ve ülke bazlı OSM şebeke runtime dosyalarıyla genelleştirmek.

**Değişiklikler:**
- İspanya ve Fransa ham OSM GeoJSON girdileri doğrulandı; `tools/build_country_grid.py` ile üç ülke için 50–550 kV sade runtime dosyaları ve manifestler üretildi.
- Gerilimler ortak `400 kV sınıfı` (300–550 kV) ve `154 kV sınıfı` (50–299.999 kV) sözleşmesine normalize edildi; gerçek OSM gerilimi ayrı korundu.
- `CountryManager`, URL/localStorage önceliği, ülke değiştirme iptalleri, async stale-response korumaları, gerçek MultiPolygon filtreleme ve lazy grid yükleme eklendi.
- Header ülke seçicisi, ülkeye göre saat dilimi, servis/analiz/export alanları, ülke önekli event/asset kimlikleri ve ülke-aware cache anahtarları eklendi.
- 400 sınıfı tüm ülkelerde `#d7191c`/2.2 px, 154 sınıfı `#111111`/1.5 px; tüm TM'ler 10×10 px siyah/mavi kare olarak standardize edildi.
- Fransa kaynağındaki 14 eksik indirme parçası manifest ve UI'da `Kısmi şebeke verisi` olarak açıkça korunur.
- Pages artifact'ı yalnız commitli `data/countries/**` runtime ağacını yayınlar; ham root GeoJSON dosyaları dışarıda kalır.

**Doğrulama:** Node regresyonları, Python import/runtime doğrulaması, üç masaüstü ülke yüklemesi, analiz/servis panelleri, hızlı ülke geçişi, 390×844 ve 844×390 responsive kontrolleri, console ve canlı Pages smoke testleri.

---

# v3.4.13 — Adaptif Rüzgâr Koridoru (10–30 km, 10 m yüzey rüzgârı)

**Branch:** `fix/v3.4.13-adaptive-corridor`

**Amaç:** Rüzgâr bazlı koridoru sabit 30 km yerine olay bazında **adaptif 10–30 km** yapmak; mesafe 10 m yüzey rüzgâr hızı + maksimum FRP ile belirlenir. 850/700 hPa yalnız görsel rüzgâr/duman bağlamıdır; koridor hesabı her zaman 10 m verisini kullanır.

**Değişiklikler:**
- **`js/config.js`** — `downwindMaxDistanceKm` kaldırıldı; `downwind` bloğu genişletildi: `minDistanceKm:10, maxDistanceKm:30, fallbackWindSpeedKmh:15, windWeight:0.65, fireWeight:0.35, windMinKmh:5, windMaxKmh:35, frpMinMw:30, frpMaxMw:300` (+ mevcut `halfAngleDeg:22, maxCorridors:30`).
- **`js/utils.js`** — `U.adaptiveCorridorDistanceKm(maxFrp, windSpeedKmh)` eklendi: windNorm ((hız − min)/(max − min), 0-1) + frpNorm (log ölçekli, 0-1) ağırlıklı, sonuç her zaman 10–30 km aralığında yuvarlanır. Hız eksikse `fallbackWindSpeedKmh` (15) kullanılır.
- **`js/grid.js`** — `analyzeEvents`: koridor yönü varsa hız gerçek/fallback; `corridorDistanceKm=U.adaptiveCorridorDistanceKm(event.maxFrp,speed)`; `assetsInSector` aynı mesafeyi alır; yön yoksa koridor çizilmez (yön uydurma yok); her analize `corridorDistanceKm, corridorWindSpeedKmh, corridorWindSource:'model'|'fallback', corridorConfidence:'normal'|'low'` eklendi. `assetsInSector` varsayılanı `C.downwind.maxDistanceKm`. Risk skoru formülü (rüzgâr 8/4/3, sıralama) değişmedi.
- **`js/app.js`** — `state.surfaceWindData` + `map.surfaceWindData` ayrı tutulur; seçili seviye 850/700 hPa ise koridor için 10 m grid'i ayrıca çekilir; `analyzeEvents` her zaman `surfaceWindData` tüketir. Görsel rüzgâr katmanı seçili seviyede kalır.
- **`js/map.js`** — koridor poligonu `a.corridorDistanceKm` yarıçapıyla çizilir; tooltip: gerçek koridor mesafesi (adaptif aralık), rüzgâr hızı/yönü, maks. FRP, model/fallback bilgisi, koridordaki hat/TM sayısı, "Operasyonel taramadır; yayılım tahmini değildir."; lejant başlığı "Rüzgâr Bazlı İzleme Koridoru · Adaptif 10–30 km", not 10 m + FRP açıklaması.
- **`js/ui.js`** — kart meta satırı sabit "30 km koridorda" yerine `a.corridorDistanceKm` gösterir.
- **`js/export.js`** — CSV'ye `corridorDistanceKm, corridorWindSpeedKmh, corridorWindSource, corridorConfidence` sütunları; JSON'a `wind.surfaceWindData`.
- **`index.html`** — koridor katman etiketi "Rüzgâr bazlı izleme koridoru (adaptif 10–30 km)" + açıklama.
- **Sürüm 3.4.13**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** v3.4.13 bloğu — config anahtarları + tekil `downwindMaxDistanceKm` yokluğu (config/grid/map/ui/app), helper çalışma zamanı çapaları (5 km/h+30 MW→10; 15 km/h+100 MW→18; ≥35+≥300→30; 0/40 km/h + 0/400 MW sınır testlerinde asla 10 altı/30 üstü değil; hız yok→15 fallback), grid.js fallback zinciri + alanlar, app.js surfaceWindData ayrımı (850/700 seçiliyken 10 m ayrı çekim + analyzeEvents yüzey verisini kullanır), map.js poligon/tooltip/lejant aynı mesafe + fallback görünürlüğü, UI/export alanları, risk skoru formülü değişmezliği. v3.4.0 koridor testi yeni config'e taşındı. Toplam **162/162** test geçti.

---

# v3.4.12 — Şebeke Öncelik Tablosu / Analiz Paneli: Varlık Gösterimi Düzeltmesi

**Branch:** `fix/v3.4.12-ui-nearest-line`

**Amaç:** Risk tablosu ve analiz kartlarında "En yakın varlık" sütununun zaman zaman **TM** göstermesini düzeltmek; kullanıcı kararıyla arayüzde yalnızca **en yakın iletim hattı** gösterilir. Risk hesaplaması (TM mesafesi, TM puan katkısı, sıralama, top-5) değişmez; haritadaki TM kare işaretleri mevcut kurallarla korunur.

**Değişiklikler:**
- **`js/grid.js`** — her olay satırına `nearestLine` (en yakın hat) / `nearestSubstation` (en yakın TM) / `displayedNearestAsset` (= `nearestLine`) alanları eklendi; `nearestAsset` (skor için en-küçük-mesafe seçimi), `assetScore`, mesafe eğrisi, sıralama ve toplam skor formülü **dokunulmadı**.
- **`js/ui.js`** — `getNearestDisplayedAsset(row){return row.nearestLine||null;}` yardımcısı eklendi; tablo ve kartlar bu yardımcıyı kullanır (yalnız hat). Kart etiketi `⚡ EN YAKIN VARLIK` → `⚡ EN YAKIN HAT`; hat yoksa tablo/kart `Yakın iletim hattı bulunamadı` gösterir. Tablo `asset`/`distance`/`voltage` sıralamaları yalnız hat mesafe/adıyla çalışır (TM sıralaması yok). Detay paneli "En yakın hat" ve "En yakın TM" satırlarını ayrı korur. Bayat bant notu 1/3/10/25 → 0.5/1.5/3/5 km olarak düzeltildi.
- **`js/config.js`** — tek kaynak `substationRiskDisplayDistanceKm: 5` eklendi.
- **`js/map.js`** — riskli TM kare guard'ı `C.impactBands.at(-1).maxKm` yerine `C.substationRiskDisplayDistanceKm` okur; lejant notu aynı anahtarı kullanır; yığın `<strong>` düzeltildi.
- **`index.html`** — tablo başlığı "En yakın varlık" → "En yakın hat"; bilgi panelinde mesafe bileşeni metni yeni eğriyle (≤0.5: 60, ≤1: 52, ≤2: 44, ≤3: 36, ≤5: 24, >5: 0) güncellendi.
- **Sürüm 3.4.12**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** v3.4.12 bloğu eklendi — config tek kaynağı (5 km), grid.js alan ayrımı + risk matematiği değişmezliği (min-mesafe seçimi, hat/TM puan kuralları, mesafe eğrisi, eski alanlar), tabloda yalnız hat (TM yokluğu, bulunamadı fallback'i), kartlarda `EN YAKIN HAT` + fallback, sıralama anahtarlarının yalnız hat kullanması (`sa?.distanceKm` yokluğu), top-5 sırası korunumu + detay paneli ayrı satırları, index.html başlık/bilgi metni. v3.4.4 min-mesafe paylaşım testi ayrıma göre yeniden yazıldı; v3.4.1/v3.4.9 map.js guard assertion'ları config anahtarına taşındı. Toplam **155/155** test geçti.

---

# v3.4.11 — Koridor TM İşaretlemesi Kaldırıldı

**Branch:** `fix/v3.4.11-no-corridor-tm-markers`

**Amaç:** Rüzgâr koridorundaki trafo merkezlerinin turkuaz kare işaretlerini tamamen kaldırmak; haritada tek TM işareti olarak yalnızca **5 km içindeki riskli TM'lerin** (siyah dolgu + mavi kenar karesi) kalmasını sağlamak.

**Değişiklikler:**
- **`js/map.js`** — `setDownwindCorridors` içindeki `dw.substations` marker döngüsü kaldırıldı (koridor yalnız kesikli turkuaz hat vurgusunu çizer); `sectorSubstationIcon()` fabrikası silindi; koridor lejantından "Koridordaki trafo merkezi" satırı kaldırıldı (açıklama: "yalnız hatlar işaretlenir; TM'ler risk katmanında ≤5 km'de gösterilir"). Koridor tooltip'indeki `N hat / N TM` sayıları bilgi olarak korundu.
- **`css/styles.css`** — `.substationSquare.substation-sector` kuralı silindi.
- **Sürüm 3.4.11**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** v3.4.1 "koridor TM kareleri" testi yerine v3.4.11 testi — `sectorSubstationIcon` yokluğu, koridor kod yolunda `L.marker` yokluğu, hat vurgusunun korunması, `substation-sector` CSS + sınıf yokluğu, koridor lejant satırının kaldırılmış olması; v3.4.10 ikon testi sektör referanslarından arındırıldı. Toplam **148/148** test geçti.

---

# v3.4.10 — TM Sembol Ayrımı: Katman / Risk / Koridor

**Branch:** `fix/v3.4.10-tm-marker-distinction`

**Amaç:** Yangından uzaktaki trafo merkezlerinin "riskli gösterim" olarak algılanması sorununu çözmek — üç ikon fabrikası da aynı mavi çerçeveli siyah dolgu kareyi ürettiği için şebeke katmanındaki tüm TM'ler risk işareti gibi görünüyordu.

**Değişiklikler:**
- **`css/styles.css`** — üç ayrı kural:
  - `.substationSquare` (temel, şebeke katmanı TM'si): 8×8, koyu dolgu `#1b2a44`, gri çerçeve `#8b98ad` — nötr varlık sembolü.
  - `.substationSquare.substation-risk` (riskli TM ≤5 km): 10×10 siyah dolgu + mavi çerçeve `#2f80ff` (korundu).
  - `.substationSquare.substation-sector` (rüzgâr koridoru TM'si): 10×10 turkuaz dolgu `#7be6ff` + koyu turkuaz çerçeve `#0e7490`.
- **`js/map.js`** — `substationIcon()` (şebeke katmanı) artık yalnız `substationSquare` temel sınıfını kullanır (8×8); `riskSubstationIcon()` değişmedi; `sectorSubstationIcon()` → `substation-sector`. Koridor lejantı turkuaz kareye geçti; risk lejantı notundaki yanlış iç içe `<strong>` düzeltildi.
- **Sürüm 3.4.10**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** v3.4.3 "tek tip kare" testi yerine v3.4.10 testi — fabrika kaynaklarında temel/risk/koridor sınıfı ayrımı (şebeke ikonu artık `substation-risk` içermez), CSS kuralları, ikon fabrikalarında inline renk yokluğu. `3.4.1` yokluk assertion'u `3\.4\.1[^0-9]` regex'ine geçirildi (3.4.10 substring çakışması). Toplam **148/148** test geçti.

---

# v3.4.9 — Riskli Şebeke İşaretlemesi En Fazla 5 km

**Branch:** `fix/v3.4.9-risk-distance-5km`

**Amaç:** Çok fazla görünen "riskli trafo merkezi" (kare) işaretlerini sınırlamak: risk işaretlemesi yalnızca yangın olayına **en fazla 5 km** mesafedeki şebeke varlıklarına (TM + hat) uygulanır; mesafe eşikleri daraltılır, mesafe ağırlığı risk skorunda artırılır.

**Değişiklikler:**
- **`js/config.js`** — `impactBands` 1/3/10/25 km → **0.5 / 1.5 / 3 / 5 km** (Kritik / Yüksek / Orta / İzleme alanı). 5 km üzeri `Düşük yakınlık (low)` bandına düşer (`U.impactBand` varsayılanı).
- **`js/grid.js`** — `analyzeEvents` mesafe skoru sertleştirildi: ≤0.5 km → 60, ≤1 → 52, ≤2 → 44, ≤3 → 36, ≤5 → 24, >5 → 0 (eskiden ≤25 km'de hâlâ 12 puan vardı). Mesafe dışı bileşenlerin üst limitleri düşürüldü: FRP 20 → 18, rüzgâr 10/5/4 → 8/4/3. **Matematiksel garanti:** mesafe dışı maksimum 18+15+10+8 = **51 < 55** (Yüksek eşiği) → 5 km'den uzak varlık asla Yüksek+/riskli olarak işaretlenemez; ≤5 km'de skor 75'e kadar çıkar.
- **`js/map.js`** — `setFireImpacts`'te TM kare ikonu `s.distanceKm <= C.impactBands.at(-1).maxKm` (5 km) koşuluyla işaretlenir (skor ≥55 şartına ek savunma); risk lejantı notuna "en fazla 5 km'deki varlıklar (mesafe ağırlıklı skor)" eklendi.
- **Sürüm 3.4.9**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** 5 yeni test — `impactBands` 0.5/1.5/3/5 değerleri + `U.impactBand` çalışma zamanı eşikleri (0.4 → critical, 1.2 → high, 2 → medium, 4.9 → watch, 6 → low fallback), grid.js yeni mesafe eğrisi + 18/8/4/3 limitleri (eski 10/25 km kademelerinin ve eski FRP üst limitinin yokluğu), **invariant: 5 km ötesinde mümkün olan maksimum skor (51) Yüksek eşiğinin (55) altında** (config'ten türetilmiş), map.js kare ikon 5 km guard'ı + lejant notu + `if(s)L.marker` yokluğu. Mevcut risk testleri (v3.4.1 kare ikon kaynağı) güncellendi. Toplam **148/148** test geçti.

---

# v3.4.8 — FIRMS Tooltip Bölge Geçmişi (Area History) Zaman Mantığı

**Branch:** `fix/v3.4.8-tooltip-area-history`

**Amaç:** Tooltip/detay panelindeki `İlk uydu tespiti` / `Son uydu tespiti` değerlerinin 6 saatlik olay kümesine değil, tespitin çevresindeki **5 km yarıçaplı bölge geçmişine** (tüm ham/dedupe FIRMS kayıtları, zaman sıralı) dayanmasını sağlamak — 6 saatten uzun gözlem aralığı olan uzun süreli yangınlarda ilk/son tespitin aynı görünmesi sorununu çözmek.

**Değişiklikler:**
- **`js/utils.js`** — iki yeni helper:
  - `timeReference(selectedTime, sliderValue=0)` — geçersiz seçim veya slider 0 (Şimdi) → şimdi; geçmiş seçim → seçili zaman; gelecek → `now + 15 dk` üstünde sınırlanır.
  - `areaHistory(fires, center, radiusKm)` — yarıçap varsayılanı `C().fireClustering.radiusKm` (5 km); geçerli lat/lon + `Date.parse(detectedAt)` filtresi; zaman sıralı (artan); `{records, count, first, last, windowHours, window48}` — `window48` = en eski kaydın yaşı ≤ 49 saat (veri penceresi ≤ 48 saat → tooltip'te `Son 48 saatte ilk uydu tespiti` etiketi).
- **`js/map.js`** — `renderFires` artık `reference = U.timeReference(this.currentSelectedTime, slider.value)` ve `radius = C().fireClustering.radiusKm` hesaplıyor; her iki `bindTooltip` çağrısı `U.areaHistory(this.fireAll, f|ev, radius)` kullanıyor; `detEvents` Map'i kaldırıldı. `firesDetectionTooltip(f, history, reference)` ve `firesEventTooltip(ev, history, reference)` yeniden yazıldı: başlık → sensör/`Maks. FRP` → tek tespitte `Bölgedeki tek uydu tespiti` (ilk/son satırları yok), değilse `[Son 48 saatte ilk uydu tespiti | İlk uydu tespiti]` + `Son uydu tespiti` → `Son tespit yaşı` (referans = seçili zaman/Şimdi; negatif yaş yok) → `Bölgedeki tespit: N` (N > 1 ise). Eski `Tespit: ... GMT+3` satırı kaldırıldı; `<br>` ile 6-7 kısa satır.
- **`js/app.js`** — tespit tıklamasında `U.areaHistory(this.map.fireAll, {lat, lon}, C.fireClustering.radiusKm)` hesaplanıp detay paneline geçirilir.
- **`js/ui.js`** — `renderPointDetail(point, air, weather, nearbyFires, areaHistory, fire, fireEvent, gridFeature, nearest)` imzası; olay ve tespit bloklarındaki eski `İlk/Son tespit` metrikleri yerine aynı bölge geçmişinden `İlk uydu tespiti` (48 saat etiketiyle), `Son uydu tespiti`, `Bölgedeki tespit` metrikleri — tooltip ile birebir aynı değerler.
- **Sürüm 3.4.8**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** 13 yeni/güncellenen test — `areaHistory` aynı bölgedeki tespitleri 6 saatlik olay sınırı boyunca birleştirir (10 saatlik aralık, 3 km mesafe → count 2, first ≠ last), uzak yangın (>5 km) + geçersiz/eksik zaman damgası dışlanır, zaman sıralaması, 48 saatlik pencere etiketi (47h → true, 60h → false), `timeReference` (Şimdi → now, geçmiş → seçili, gelecek sınırı, negatif olmayan yaş), tooltip builder imzaları + ifadeler + `detEvents` yokluğu + `Tespit:` satırı yokluğu + `<br><br>` yokluğu, `renderFires` bağlantısı, runtime çıktılar: bölge ilk/son/sayı, tek tespit (`Bölgedeki tek uydu tespiti`), 48 saat etiketi, 6 saat sınırı boyunca küme geçmişi (olay sayısı 5 korunur, bölge sayısı 8), tooltip ve detay panelinin aynı `areaHistory` değerlerini paylaşması.

---

# v3.4.7 — UI/Tooltip Hotfix: Minimal FIRMS Tooltip

**Branch:** `fix/v3.4.7-minimal-tooltip`

**Amaç:** NASA FIRMS termal tespiti hover tooltip'ini minimal ve faydalı hale getirmek; uzun uyarı/not bloklarını kaldırmak; tarih/saatleri okunur Türkçe formatta göstermek; son tespit yaşını dinamik hesaplamak.

**Değişiklikler:**
- **`js/utils.js`** — iki yeni formatter:
  - `formatTrShortDateTime(date)` → `31 Temmuz 14.20` / `2 Ağustos 02.10` (Türkiye saati, Türkçe ay adı, nokta ile HH.MM; geçersiz girdide `null`).
  - `formatAgeSince(iso, reference)` → `11 saat 40 dakika`, `1 saat`, `45 dakika`, `1 gün 3 saat`, `1 dakikadan az` (dinamik; geçersiz girdide `null`).
- **`js/map.js`** — `firesDetectionTooltip(f, ev, reference)` ve `firesEventTooltip(ev, reference)` builder'ları; `renderFires` içinde tespit→olay eşlemesi için `detEvents` Map'i (olay üyeleri aynı nesne referansları). Tekil tespit tooltip'i: başlık → sensör (`product`) → `FRP: X.XX MW` → `Tespit: ... GMT+3` → `İlk uydu tespiti` → `Son uydu tespiti` (olayın `earliestDetectedAt`/`latestDetectedAt`'inden; olay yoksa satırlar gösterilmez) → `Son tespit yaşı` (referans = seçili zaman/now). Olay kümesi tooltip'i aynı kompakt düzende yenilendi. `Hotspot = yangın perimetresi değildir.` ve `5 km / 6 saat kümelenmiş; yangın perimetresi değildir.` notları kaldırıldı; `<br><br>` yok; 6-7 kısa satır.
- **Sürüm 3.4.7**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** 8 yeni test — `formatTrShortDateTime` çıktıları (Türkiye saati), `formatAgeSince` çıktıları (saat/dakika/gün/dakikadan az/null), tooltip builder'ların varlığı + uzun notların kaldırıldığı + `<br><br>` yokluğu, `detEvents` map + bindTooltip bağlantısı, runtime çıktılar: olaylı tespit (7 satır, `İlk uydu tespiti: 31 Temmuz 14.20`, `Son tespit yaşı: 11 saat 40 dakika`), olaysız tespit (ilk/son uydu satırları yok, yaş kendi tespitinden), küme tooltip'i.

**Tarayıcı doğrulama:** Desktop 1440×900 + mobil 390×844 — gerçek hover ile tooltip açılıyor; alan sırası başlık/sensör/FRP/Tespit/İlk/Son/Yaş; yaş dinamik; veri yoksa satır yok; taşma yok; console exception yok.

---

# v3.4.6 — UI Hotfix: Karşılıklı Özel Solid Paneller

**Branch:** `fix/v3.4.6-exclusive-solid-panels`

**Sorunlar:**
1. `#analysisSummaryPanel` şeffaftı — arka plan, border, padding, backdrop-filter ve box-shadow yoktu; harita yazıları panel arkasından görünüyordu. Lejant kartlarındaki görünüm `.legend` sınıfında vardı.
2. Lejant ve analiz panelleri aynı anda açık kalabiliyordu (butonlar yalnız kendi `legendsHidden`/`analysisHidden` sınıfını değiştiriyordu).
3. `body.analysisOpen` lejant butonunu/paneli yukarı kaydırıyordu (`bottom:182px`/`216px`, mobil `200px`/`232px`); paneller birlikte açıkken yerleşim bozuluyordu.

**Değişiklikler:**
- **Ortak panel görünümü**: `.analysisStack` artık lejant kartıyla aynı visual: `padding:8px; background:#09151fee; backdrop-filter:blur(8px); border:1px solid var(--line); border-radius:9px; box-shadow:var(--shadow); font-size:9px` + `bottom:142px` (lejant ile aynı konum), `width/max-width:min(220px,calc(100vw - 16px))`. Mobilde `left:8px; bottom:158px` (lejant ile aynı). Header, alt açıklama ve kartlar panel sınırları içinde; arka plan opak + blur → harita yazıları görünmez.
- **Karşılıklı özellik**: UIManager'a merkezi `setLegendOpen(open)` / `setAnalysisOpen(open)` helper'ları eklendi (sınıf toggle + buton metni `Gizle/Göster` + `aria-expanded` + panel `aria-hidden`). Event binding: lejant açılacaksa önce `setAnalysisOpen(false)`; analiz açılacaksa önce `setLegendOpen(false)`; × → `setAnalysisOpen(false)`; aynı butona ikinci basış kendi panelini kapatır. `toggleRiskSummary()` kaldırıldı.
- **Kaydırma kaldırıldı**: `body.analysisOpen .legendToggleBtn` ve `body.analysisOpen .legendStack` kuralları (desktop + mobil) silindi; `document.body.classList.toggle('analysisOpen',...)` kullanımı kaldırıldı. Butonlar sabit: desktop 108/74, mobil 126/92.
- **Mobil layer panel**: dar ekranda (≤520px) analiz VEYA lejant açıldığında `#layerPanelBody` ortak `holdLayerPanel(true)` helper'ıyla geçici kapatılır (collapse butonu `+` ile senkron); panel kapanınca layer paneli otomatik yeniden açılmaz.
- **Erişilebilirlik**: HTML başlangıç durumları — her iki butonda `aria-expanded="false"`, her iki panelde `aria-hidden="true"`; helper'lar bu değerleri günceller.
- **Sürüm 3.4.6**: `package.json`, `js/config.js`, `index.html` (pill + cache-buster), `server.mjs`, `README.md`, sürüm geçmişi.

**Testler:** v3.4.6 bloğu — helper'ların varlığı + aria senkronu, karşılıklı kapanma kod yolları (lejant açılınca analiz kapanır ve tersi), `body.analysisOpen` kalıntısı yok (JS + CSS), buton sabit konumları (108/74, 126/92), mobil analiz/lejant aynı 158px hizası, aria başlangıç durumları. v3.4.4 "toggle bağımsızlığı" testi "paneller karşılıklı özel" olarak yeniden yazıldı; duplicate-ID testleri korundu.

**Tarayıcı doğrulama:** Desktop 1440×900 + mobil 390×844 — başlangıçta iki panel kapalı; lejant açılır (analiz kapalı kalır); analiz açılır (lejant otomatik kapanır); lejant tekrar açılır (analiz otomatik kapanır); aynı buton ikinci basış kendi panelini kapatır; × analizi kapatır; her etkileşim sonrası `!(legendOpen && analysisOpen)`; panel computed `background alpha > 0.85`, border ve backdrop-filter mevcut; genişlik lejant toleransında; `elementFromPoint` görünür buton; yatay overflow yok; console exception yok. Gerçek pointer (CDP `Input.dispatchMouseEvent` + `Page.bringToFront`).

---

# v3.4.5 — Acil Hotfix: Duplicate DOM ID'ler (Analizi Göster)

**Branch:** `fix/v3.4.5-analysis-duplicate-dom`

**Sorun:** v3.4.4 yayınında `index.html` içinde `#analysisToggle` (buton) ve `#analysisSummaryPanel`/`#analysisClose`/`#analysisSummaryBody` (panel bloğu) ikişer kez bulunuyordu. İlk buton/panel bloğu üzerine aynı bloğun ikinci kez eklenmesi (sürüm betiğindeki substring anchor eşleşmesi) sonucu oluşmuştu. `getElementById` ilk eşleşmeyi döndürdüğü için programatik `.click()` testleri geçti; ancak gerçek kullanıcı tıklaması üstte duran, bağlanmamış ikinci butona çarpıyor ve panel açılmıyordu.

**Değişiklikler:**
- **Duplicate kaldırıldı**: `#analysisToggle` butonu ve `#analysisSummaryPanel` panel bloğu (içindeki `#analysisClose`, `#analysisSummaryBody` ile) tekilleştirildi — DOM'da her biri tam 1 adet.
- **DOM tekillik sözleşmesi** (`js/ui.js` init): `requiredUniqueIds` listesi (`analysisToggle`, `analysisSummaryPanel`, `analysisClose`, `analysisSummaryBody`) `querySelectorAll` ile sayılır; `count !== 1` ise `console.error('DOM contract violation: #id count=N')`.
- **Binding korundu**: `document.getElementById('analysisToggle')?.addEventListener('click',()=>this.toggleRiskSummary())` aynen duruyor.
- **Sürüm 3.4.5**: `package.json`, `js/config.js` (`appVersion`), `index.html` (buildPill + `?v=` cache-busting), `server.mjs` (`APP_VERSION`), `README.md`, sürüm geçmişi.

**Testler:** `tests.mjs` — 4 kritik ID'nin count === 1 assertion'ları, index.html'deki TÜM `id=` değerlerinin global unique olması (duplicate → FAIL), lejant ID'lerinin etkilenmediği, ui.js binding'inin korunduğu ve init sözleşme kontrolünün varlığı.

**Tarayıcı doğrulama:** Gerçek pointer testi — `elementFromPoint(centerX, centerY) === #analysisToggle`, CDP `Input.dispatchMouseEvent` ile buton merkezine tıklama (panelde `analysisHidden` yok, buton metni "Analizi Gizle", `pointer-events !== none`), ikinci tıklama kapar, × kapatır; 1440×900 ve 390×844 viewportlarında. Canlı Pages'te `querySelectorAll('#analysisToggle').length === 1` vb. koşulları PASS için zorunlu.

**Bonus düzeltme (pointer testlerinin yakaladığı):** Dar ekranlarda (≤520px) sağ üstteki `#layerPanel` (260px genişlik, `main` içinde `top:58px`) analiz panelinin sağ üst köşesindeki × butonunu ve üst kartların tıklama bölgesini kapatıyordu — programatik `.click()` testleri bu hatayı göremezdi (hit-test'e girmez). Çözüm: `toggleRiskSummary` analiz panelini açarken dar ekranda `#layerPanelBody`'yi uygulamanın kendi `hidden` sınıfıyla geçici olarak kapatır (collapse butonu metni `+` ile senkronize olur); analiz kapandığında layer paneli olduğu gibi kalır.

---

# v3.4.4 — ⚡ Şebeke Risk Özeti Paneli

**Branch:** `feature/v3.4.4-risk-summary-panel`

**Değişiklikler:**
- **Analizi Göster/Gizle toggle**: `index.html`'de `legendToggleBtn`'in hemen altına `#analysisToggle` eklendi (`.analysisToggleBtn` — lejant butonuyla aynı paylaşımlı kural: aynı genişlik/yazı/yükseklik). Tıklama `ui.toggleRiskSummary()` ile açılır/kapanır; buton metni `⚡ Analizi Göster ↔ ⚡ Analizi Gizle` değişir.
- **Panel**: `#analysisSummaryPanel` (`.analysisStack`), `legendHeader`/`legendTitle`/`legendClose` (×) iskeletini yeniden kullanır; alt açıklama "En yüksek öncelikli 5 yangın olayı"; kartlar `#analysisSummaryBody` içine render edilir. Lejanttan tamamen bağımsız (kendi `analysisHidden` sınıfı; lejant `legendsHidden`'a dokunmaz).
- **Kartlar**: en fazla 5 kompakt kart — `#1`–`#5` sıra rozeti, mevcut `.riskBadge.{level}` seviye rengi (KRİTİK/YÜKSEK/ORTA/DÜŞÜK/İZLEME), `🔥 Yangın #<id>` + tespit sayısı, vurgulu `⚡ EN YAKIN VARLIK` bloğu (hat ⇔ TM en-küçük-mesafe seçimi, ad + voltaj + mesafe), alt meta satır (FRP, rüzgâr koridoru yönü, risk skoru). Boşsa `Aktif şebeke riski bulunamadı.`.
- **Aynı veri kaynağı**: `ui.riskTableRows(arr)` ortak boru hattı çıkarıldı — tablo filtre/sıralama mantığının birebir kopyası (minDistanceKm≤25, ilk 200, `sortKey/sortDir`); hem `renderImpact` (tablo) hem `renderRiskSummary` (kartlar) aynı fonksiyondan beslenir → kart sırası tablonun görünen ilk-5'i ile birebir aynı.
- **Tıklama → odak**: kart `A.Events.emit('focusRisk', rows[i])` fırlatır; mevcut `app.js` handler'ı haritayı olaya odaklar + noktayı seçer (tablo satırıyla aynı nesne).
- **Canlı güncelleme**: `renderImpact` sonuna `this.renderRiskSummary()` eklendi → FRP kaydırıcısı, zaman tüneli, FIRMS yenileme, rüzgâr/koridor güncellemeleri paneli de tazeler; açıkken yeniden render `toggleRiskSummary` içinde.
- **Mobil**: panel `max-width:min(220px,calc(100vw - 16px))`, `max-height:40dvh`, iç scroll; butonlar aynı genişlik; `body.analysisOpen` ile lejant buton/stack'i yukarı kayar (çakışma yok).
- **Sürüm 3.4.4**: `package.json`, `js/config.js` (`appVersion`), `index.html` (buildPill + `?v=` cache-busting), `server.mjs` (`APP_VERSION`), `README.md`, sürüm geçmişi.

**Testler:** `tests.mjs` — buton varlığı/DOM sırası/ortak stil kuralı, panel markup'ı (legendHeader yeniden kullanımı, başlık, alt açıklama, kapat), panel CSS (sınırlar, gizli durum, `analysisOpen` kaydırmaları), kart markup'ı (sıra, rozet, EN YAKIN VARLIK, FRP, skor, boş durum), tablo ile aynı kaynak/sıralama (riskTableRows tek boru), min-mesafe seçim paylaşımı, kart tıklama → focusRisk + aynı satır nesnesi, lejanttan bağımsızlık (ayrı gizli sınıflar), canlı güncelleme (renderImpact içinde çağrı).

---

# v3.4.3 — Varsayılan Katmanlar + FRP 30 + Tek Tip TM Karesi

**Branch:** `fix/v3.4.3-default-layers-substation-style`

**Değişiklikler:**
- **FRP varsayılanı 50 → 30 MW**: `js/config.js`'e `frpThreshold: 30` eklendi (tek kaynak). `js/app.js` state (`frpThreshold:C.frpThreshold`), `js/map.js` constructor (`this.frpThreshold=C.frpThreshold`) ve `index.html` slider (`value="30"`, `≥30 MW`) hepsi aynı sabiti kullanır — magic number yok, reset/default tutarlı.
- **Varsayılan katmanlar AÇIK**: `index.html`'de `layerThermalEnvelope`, `layerEffisBurntArea`, `layerDownwindCorridor` checkbox'ları `checked` oldu; `app.js` state'te `effisBurntAreaEnabled:true`, `downwindEnabled:true`; `init()` içine `if(this.state.effisBurntAreaEnabled)this.map.toggleEffisBurntArea(true,this.state.selectedTime)` eklendi (EFFIS BA ilk açılışta uygulanır). localStorage kayıtları varsa kullanıcı tercihi korunur.
- **Tek tip TM risk karesi**: `js/map.js` içinde üç ikon fabrikası (`substationIcon`, `riskSubstationIcon`, `sectorSubstationIcon`) aynı 10×10 kareyi üretir: `<span class="substationSquare substation-risk">`. `css/styles.css`'te seviye sınıfları (`substation-risk-critical/high/medium/low`) ve eski inline boyut/renk şablonları kaldırıldı; tek kural: `.substationSquare.substation-risk{width:10px;height:10px;background:#000;border:2px solid #2f80ff;box-sizing:border-box}`. Risk ve koridor lejant örnekleri de aynı stile geçti.
- **Sürüm 3.4.3**: `package.json`, `js/config.js` (`appVersion`), `index.html` (buildPill + `?v=` cache-busting), `server.mjs` (`APP_VERSION`), `README.md`.

**Testler:** `tests.mjs` — FRP 30 tek kaynak/slider/label, üç katman varsayılan açık + init uygulaması, üç ikon fabrikası eşit 10×10 kare, eski seviye-boyut/renk kalıntısı yok.

---

## 1. TileLayer `_getSubdomain` Hatası Düzeltildi

**Dosya:** `js/map.js:29`

**Sorun:** Leaflet `TileLayer` oluşturulurken `subdomains: useProxy ? undefined : cfg.subdomains` kullanılıyordu. Proxy modunda `undefined` değeri Leaflet'in varsayılan `'abc'` değerini ezip geçersiz kılıyor, `getTileUrl` içinde `_getSubdomain` çağrıldığında `undefined.length` hatası fırlatıyordu. Harita tile'ları yüklenemiyor, harita gri/kapalı kalıyordu.

**Çözüm:** `subdomains: cfg.subdomains || 'abc'` — `cfg.subdomains` tanımsız olsa bile Leaflet varsayılanı kullanılır.

---

## 2. Yangın Olayı Tablosu Sıralanabilir Yapıldı

**Dosyalar:** `js/ui.js`, `index.html`, `css/styles.css`

**Değişiklikler:**
- Tablo başlıklarına (`<th>`) `data-sort` attribute'ları eklendi (riskScore, count, maxFrp, asset, distance, voltage, wind, latest)
- `UIManager` constructor'ına `sortKey` ve `sortDir` state'i eklendi
- `init()` içinde başlık tıklama dinleyicisi eklendi
- `renderImpact()` içinde `this.sortKey`/`this.sortDir`'e göre sıralama eklendi (8 sütun için ayrı ayrı comparator)
- Sıralama okları (▲▼) CSS ile eklendi, sıralanmayan sütunlarda gri ⇅

**Kullanım:** Herhangi bir sütun başlığına tıklayın. Tekrar tıklayınca sıralama yönü değişir.

---

## 3. FRP (Fire Radiative Power) Filtresi Eklendi

**Dosyalar:** `js/map.js`, `js/app.js`, `index.html`

**Değişiklikler:**
- Katmanlar → Yangın bölümüne **Min. FRP filtresi** slider'ı eklendi (0–200 MW, step 5, default 50)
- `app.state.frpThreshold: 50` state'e eklendi
- `MapManager.frpThreshold: 50` özelliği eklendi
- `renderFires()` içinde:
  - Küme modunda (zoom < 9): `fireEventsVisible` FRP eşiğine göre filtrelenir
  - Hotspot modunda (zoom ≥ 9): tekil tespitler FRP'ye göre filtrelenir
- FRP değişim olay dinleyicisi `bindUI()` içinde eklendi
- `restoreSettings()` içinde slider değeri geri yüklenir
- `toggleHeat()` FRP filtresi ve `insideRegion()` ile güncellendi

---

## 4. FRP Filtresi Tüm Harita Katmanlarına Yayıldı

**Dosya:** `js/map.js`

**Değişiklikler:**
- `renderFires()`: `fireEventsVisible` artık FRP eşiği altındaki olayları içermez (kümeleme sonrası filtreleme)
- **Risk halkaları** (`setFireImpacts()`): Sadece eşik üstü olaylar için çizilir
- **Rüzgâr koridorları** (`setDownwindCorridors()`): Sadece eşik üstü olaylar için çizilir
- **Etki analizi** (`updateImpact()`): Tablo ve analizler sadece eşik üstü olayları kapsar
- KPI kartı filtreli sayıyı gösterir

---

## 5. Türkiye Sınırı Dışındaki Çizimler Kaldırıldı

**Dosya:** `js/map.js`

**Değişiklikler:**
- **Şebeke hatları/TM'leri** (`setGridGroup()`): `L.geoJSON`'a `filter` eklendi — koordinatı Türkiye dışında olan feature'lar gösterilmez
- **Risk halkaları** (`setFireImpacts()`): `!U.insideRegion()` kontrolü eklendi
- **Rüzgâr koridorları** (`setDownwindCorridors()`): `!U.insideRegion()` kontrolü eklendi
- **FRP ısı haritası** (`toggleHeat()`): `insideRegion()` ve `frpThreshold` filtrelemesi eklendi
- FIRMS hotspotları zaten `setFires()` içinde `insideRegion()` ile filtrelenmekteydi
- Duman ve rüzgâr verisi zaten veri çekme aşamasında Türkiye bbox ile sınırlıydı

---

## 6. Bilgi Sekmesi Eklendi

**Dosya:** `index.html`

**Değişiklikler:**
- Navigasyona **ℹ Bilgi** butonu eklendi (Ayarlar'dan sonra)
- 4 kart grubu içeren yeni `#view-info` bölümü eklendi:

### 6.1 Teknik Terimler ve Kısaltmalar
| Terim | Açıklama |
|---|---|
| FIRMS | NASA Fire Information for Resource Management System — uydu tabanlı termal anomali tespiti |
| FRP | Fire Radiative Power (MW) — yangının anlık ısıl gücü |
| VIIRS | Suomi NPP, NOAA-20/21 uyduları sensörü (375/750 m çözünürlük) |
| MODIS | Terra/Aqua uyduları sensörü (1 km çözünürlük) |
| CAMS | Copernicus Atmosphere Monitoring Service — atmosfer bileşimi modeli |
| PM10 | Partikül madde <10 µm, yangın dumanının ana bileşeni |
| EFFIS/FWI | European Forest Fire Information System / Fire Weather Index |
| OSM Grid | OpenStreetMap gönüllü haritalama verisi (ODbL 1.0) |
| TM | Trafo Merkezi (Substation) |
| Hotspot | FIRMS termal anomali pikseli (yangın perimetresi değildir) |
| Küme | 5 km / 6 saat uzamsal-zamansal kümeleme |

### 6.2 Analiz Metrikleri ve Skorlama
| Metrik | Açıklama |
|---|---|
| Risk Skoru (0-100) | Mesafe + FRP + yaş + varlık önemi + rüzgâr bileşik skoru |
| Mesafe Bileşeni (0-50) | ≤1 km: 50, ≤3 km: 42, ≤10 km: 28, ≤25 km: 12 |
| FRP Bileşeni (0-20) | √(maxFRP) × 2 |
| Yaş Bileşeni (0-15) | ≤3 sa: 15, ≤6 sa: 12, ≤12 sa: 8, ≤24 sa: 4 |
| Varlık Bileşeni (0-10) | TM/400 kV: 10, 154 kV: 7 |
| Rüzgâr Bileşeni (0-10) | Doğrultuda: 10, çapraz: 5, koridorda varlık: 4 |
| Risk Kategorileri | Kritik (75+), Yüksek (55-74), Orta (35-54), İzleme (0-34) |
| Yakınlık Bandı | Kritik (≤1 km), Yüksek (≤3 km), Orta (≤10 km), İzleme (≤25 km) |
| Rüzgâr Koridoru | 50 km / ±22° sektör taraması (duman yörüngesi değildir) |
| Duman Görselleştirme | Canvas tabanlı radyal gradient interpolasyonu (~11 km çözünürlük) |

### 6.3 Önemli Sınırlamalar
- Hotspot ≠ Yangın Perimetresi
- Rüzgâr Koridoru ≠ Duman Yörüngesi
- Risk Skoru ≠ Arıza Olasılığı
- Uydu boşlukları (bulut, duman, geçiş zamanlaması)
- Veri gecikmesi (FIRMS: ~15-60 dk, CAMS/Open-Meteo: saatlik)
- Şebeke kapsamı yalnız OSM verisi ile sınırlı

### 6.4 Veri Kaynakları ve Referanslar
- NASA FIRMS: firms.modaps.eosdis.nasa.gov
- CAMS / Open-Meteo: open-meteo.com
- Open-Meteo Weather: open-meteo.com
- Copernicus EFFIS: effis.emergency.copernicus.eu
- OpenStreetMap: openstreetmap.org

---

## 7. Katman Paneli Geliştirildi

**Dosya:** `index.html`, `js/app.js`, `js/ui.js`

**Değişiklikler:**
- FRP slider'ı altında **"X / Y olay gösteriliyor"** sayacı eklendi
- `firesRendered` event'i `eventsTotal` alanı ile genişletildi
- Slider değiştiğinde sayaç anlık güncellenir
- İlk yüklemede `restoreSettings()` içinde sayaç sıfırlanır

---

## Değişiklik Özeti (Dosya Bazında)

| Dosya | Değişiklik |
|---|---|
| `js/map.js` | TileLayer subdomains fix, FRP filtreleme, Turkey bounds clipping, toggleHeat güncelleme |
| `js/app.js` | FRP state, bindUI olay dinleyicisi, restoreSettings güncelleme |
| `js/ui.js` | Sort state, sort click handler, renderImpact sıralama, firesRendered sayaç |
| `index.html` | FRP slider, Bilgi sekmesi, sort data attrs, nav butonu, sayaç span |
| `css/styles.css` | Sort arrow CSS, sortable th stilleri |

---

# v3.4.1 — MTG WMS + Trafo Risk Sembolü Düzeltmesi

**Branch:** `fix/v3.4.1-mtg-risk-symbols`

## MTG WMS endpoint ve protokol
- Endpoint resmi **EUMETView GeoServer**'a taşındı: `https://view.eumetsat.int/geoserver/wms` (eski EUMETView GeoServer URL'i tüm repodan kaldırıldı; o adres SPA HTML döndürüyordu).
- GetCapabilities'a göre **WMS 1.3.0**'a geçildi (`srs` parametresi kaldırıldı; 1.3.0 + EPSG:4326 eksen sırası lat,lon — Leaflet `crs: L.CRS.EPSG4326` ile BBOX'ı otomatik y,x gönderir).
- Canlı contract testi: GetCapabilities → layer `mtg_fd:rgb_geocolour` → TIME arşivi (start/end/PT10M) → 64×64 GetMap → HTTP 200 + `image/png` + PNG magic byte doğrulaması. Ağ yoksa **SKIPPED — network unavailable**.

## Time-slot hesabı
- `Math.round` kaldırıldı → **`Math.floor(ms/slot)*slot`** (12:56 → 12:50, asla 13:00).
- `Math.min(slot, latestAllowedNowSlot)` uygulandı: timeline +3h/+12h konumunda MTG son mevcut gerçek frame'de kalır (gelecek frame üretilmez); lejantta "Uydu görüntüsü: son mevcut gerçek frame" notu.

## Frame-bazlı backfill (`MtgFrameManager`)
- State: `frameSeq`, `requestedFrame`, `lastUserTime`, `displayedTime`, `loadedTileCount`, `failedTileCount`, `backfillAttempt`.
- Tile'lar `tileloadstart`'ta `dataset.frameSeq` ile damgalanır; stale (eski frame) tile eventleri yeni frame'i etkilemez.
- Bir frame'de **en az 1 başarılı tile → OK**; tamamen başarısız → 3 sn settle penceresi sonrası **yalnız bir kez** 10 dk geri sarılır; maksimum 12 slot; sonunda `no-frame` ("Arşivde görüntü yok").
- İlk başarısızlıkta küçük 64×64 **probe** yapılır: HTML/SPA yanıtı → `Geçersiz WMS yanıtı` (backfill durdurulur), ağ hatası → `WMS bağlantı hatası`.

## Gösterilen zaman ayrımı
- `mtgRequestedTime` (kullanıcı seçimi) ve `mtgDisplayedTime` (ekrandaki gerçek frame) ayrı tutulur.
- Lejant: "Seçilen: 14:30 UTC / Uydu karesi: 14:10 UTC"; service monitor: "Bağlı · Frame: …" / "Gecikmeli frame · İstenen: … · Gösterilen: …".

## MTG 10 dk playback
- MTG açıkken playback adımı 10 dk/frame (`timeline.mtgPlayStepMinutes: 10`), kapalıyken mevcut 3 saat; `setTimeOffset` MTG modunda dakikaları korur (`setUTCSeconds(0,0)`).
- WMS katmanı reuse + 200 ms debounce + stale-frame ignore; 48 sa geçmiş sınırı mevcut timeline min değeriyle korunur.

## Riskli trafo merkezleri kare
- `setFireImpacts` en yakın TM ve rüzgâr koridoru TM'leri artık kare (`riskSubstationIcon`, `sectorSubstationIcon`); boyutlar risk seviyesine göre: kritik 14 / yüksek 12 / orta 10 / izleme 8 px; risk rengi korunur; hat gösterimi değişmedi.
- Risk lejantına kare TM sembolü, koridor lejantına kare TM satırı eklendi.

## Service monitor
- Yeni durumlar: `loading` (Yükleniyor), `ok` (Bağlı), `backfill` (Gecikmeli frame), `no-frame` (Kare yok), `error` (Hata / Geçersiz WMS yanıtı / bağlantı hatası).

## Testler
- 84 → **101 test**; `node tests.mjs` 101/101 PASS (canlı EUMETView contract dahil).

---

# v3.4.2 — MTG Küçük Düzeltmeler

**Branch:** `fix/v3.4.2-mtg-small-fixes`

## Backfill bütçesi sıfırlama
**Dosya:** `js/map.js` — `MtgFrameManager.applyUserTime(iso)`

**Sorun:** Yeni kullanıcı/timeline zamanı geldiğinde `backfillAttempt` sıfırlanmıyordu; böylece önceki zaman seçiminden kalan backfill sayacı yeni seçimin bütçesini kısaltıyordu (örn. önceki seçim 5 backfill yapmışsa yeni seçim en fazla 7 backfill yapabiliyordu).

**Çözüm:** `applyUserTime` artık `backfillAttempt = 0` ile başlar — her yeni kullanıcı isteği kendi tam 12-slot bütçesini alır. Reset **yalnız** kullanıcı zamanı yolunda (`applyUserTime`) çalışır; `applyBackfill()` bütçeyi değiştirmez; aynı frame için max 12 limiti aynen korunur.

## Tekrarlanan UTC eki
**Dosya:** `js/map.js` — `mtgFmt()`

**Sorun:** `mtgFmt()` çıktısı zaten `" UTC"` içeriyor; lejant ve service-monitor şablonları buna bir ` UTC` daha ekliyordu → "Seçilen: 14:30 UTC UTC" benzeri hatalı metinler.

**Çözüm:** Tüm MTG metin şablonlarındaki gereksiz ` UTC` ekleri kaldırıldı:
- Lejant: `Seçilen: ${mtgFmt(req)}` / `Uydu karesi: ${mtgFmt(disp)}`
- Service monitor ok: `· İstenen: ${mtgFmt(...)}`
- Backfill notu: `Gecikmeli frame · İstenen: ${mtgFmt(...)} · ${mtgFmt(target)} deneniyor`
- No-frame notu: `Arşivde görüntü yok · ${mtgFmt(req)}`
- Repo genelinde `UTC UTC` oluşturacak şablon kalmadı (statik regex testi ile korunur).

## Testler
- **101 → 104 test**; yeni regression testleri:
  - request A → 5 backfill, request B → `backfillAttempt === 0` (bütçe sıfırlanır), B kendi 12-slot bütçesini sonuna kadar kullanır → exhausted.
  - `applyBackfill` bütçeyi sıfırlamaz.
  - MTG metinlerinde çift `UTC` yok; her zaman damgasında tam bir `UTC`.
