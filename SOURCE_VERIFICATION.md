# Veri Kaynağı Doğrulama Notları — v3

Bu dosya uygulamanın hangi kaynağı ne amaçla kullandığını açıklar. Servislerin çalışma durumu uygulama içindeki **Ayarlar / Kaynaklar → Veri Kaynağı Durumu** tablosunda gerçek isteklerle ayrıca gözlenir.

| Kaynak | Servis | Auth | Uygulamadaki rol | Not |
|---|---|---|---|---|
| NASA FIRMS | Area CSV API | MAP_KEY | Termal tespit, FRP | Hotspot yangın perimetresi değildir |
| Open-Meteo Air Quality | `/v1/air-quality` | Yok / hizmet koşullarına bağlı | CAMS Europe `pm10_wildfires` (toplam PM10 yalnız wildfire payı hesabında dahili) | Avrupa domaini yaklaşık 0.1° (~11 km), saatlik |
| Open-Meteo Weather | `/v1/forecast` | Yok / hizmet koşullarına bağlı | 10 m, 850 hPa, 700 hPa rüzgâr | Duman yörüngesi değildir |
| Copernicus EFFIS | WMS | Public WMS | `ecmwf007.fwi` | TIME kullanılır; WMS tile değerinden sahte sayısal FWI üretilmez |
| AtmoHub | Portal keşfi | Bilinmiyor | Doğrulanırsa gelecekte native smoke/fire kaynağı | Endpoint uydurulmaz |
| OpenStreetMap | Kullanıcı GeoJSON dışa aktarımı | Yok | Hatlar + TM | ODbL attribution korunur |

## AtmoHub keşif kuralı

`server.mjs` portal HTML ve aynı domaine ait istemci bundle'larını tarar. Bulduğu mutlak API/WMS/smoke/fire adaylarından sınırlı sayıda URL için HTTP 200 ve içerik tipi kontrolü yapabilir. Bu kontrol tek başına veri şeması, lisans, auth veya browser CORS uygunluğunu garanti etmez. Bu nedenle adaylar **otomatik olarak harita katmanı yapılmaz**.

## CAMS wildfire PM10

Open-Meteo Air Quality API dokümantasyonunda `PM10 caused by wildfires` değişkeni desteklenmektedir. Uygulamadaki “Yangın kaynaklı PM10 plume” bu gerçek değişkenden alınan örnek noktalardan çizilir. Sürekli plume görünümü sadece kartografik interpolasyondur; model çözünürlüğünü değiştirmez.

## Harita altlıkları

Altlıklar yalnız kullanıcı görünümündeki tile'ları ister; uygulama offline/bulk tile indirme yapmaz. Attribution Leaflet haritasında görünür tutulur.
