# v3.2.0

- Harita üzerindeki coğrafi kilit kaldırıldı: dünya üzerinde serbest pan/zoom.
- Türkiye sınırı yalnız gerçek veri sorgularına uygulanır (FIRMS, CAMS/Open-Meteo, şebeke etki analizi).
- SUNUCU MODU için Esri/OSM/CARTO/OpenTopoMap tile proxy eklendi; doğrudan tarayıcı tile sorunlarına karşı daha dayanıklı.
- Türkiye görünümünün dışına çıkıldığında CAMS/rüzgâr istekleri yapılmaz ve plume temizlenir.
- AtmoHub Yöntem 1 canlı keşfi yeniden yazıldı: ana portal + tematik sayfalar + JS/CSS bundle taraması, relative endpoint çözümleme, WMS/tile/raster/API aday sınıflandırması, cache-bypass ve ayrıntılı hata raporu.
- Doğrulanmamış AtmoHub endpointleri veri katmanı yapılmaz.
- Sürüm 3.2.0; varsayılan port 8890 (doluysa sonraki boş port).
