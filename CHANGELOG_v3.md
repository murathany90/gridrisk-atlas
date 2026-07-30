# v3 — Wildfire Grid Risk odaklı güncelleme

- Türkiye bbox dışındaki API/grid örnekleri filtrelendi.
- Genel PM2.5, PM10, European AQI ve AOD harita katmanları kaldırıldı.
- CAMS Europe `pm10_wildfires` ana duman katmanı yapıldı.
- Wildfire PM10 / toplam PM10 oranı ayrı türetilmiş katman olarak bırakıldı.
- Uydu altlığı varsayılan yapıldı; wildfire PM10 AtmoHub benzeri yumuşak yarı saydam plume olarak çiziliyor.
- Duman görünümü opacity kontrolü eklendi; sıfır/veri-yok hücresinden duman üretilmiyor.
- Esri World Imagery, OSM Standard, CARTO Positron, CARTO Dark Matter, OpenTopoMap altlıkları eklendi.
- Tüm lejantlar tek düğmeyle gizlenebilir ve her biri × ile bağımsız kapatılabilir.
- FIRMS tespitleri 5 km / 6 saat ile olay kümelerine dönüştürüldü; yakın zoom'da ham hotspot görünümü korunuyor.
- Hotspot/olay sembollerine tespit yaşı opacity'si ve FRP ölçeklemesi uygulandı.
- OSM şebekesi varsayılan kapalı; 400 kV, 154 kV, TM ve isteğe bağlı diğer gerilim katmanlarına ayrıldı.
- En yakın riskli hat segmenti / TM glow ile vurgulanıyor.
- 50 km ±22° aşağı-rüzgâr izleme sektörü ve sektör içindeki hat/TM vurgusu eklendi.
- Yangın olayı tabanlı operasyonel öncelik skoru ve risk tablosu eklendi.
- KPI'lar ham hotspot sayısı yerine yangın olayı / kritik olay / risk altındaki benzersiz hat ve TM sayısına çevrildi.
- AtmoHub public endpoint uydurulmadı; yalnız Node üzerinden portal/bundle keşfi ve sınırlı HTTP/content-type doğrulaması var.
- Demo/mock veri yolu bulunmuyor.
