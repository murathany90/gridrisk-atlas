# Geliştirme Kaydı — Türkiye Wildfire Grid Risk Monitor v3.2.0

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
