# v3.1.1

- Eski localhost sunucusunun açılması problemi giderildi.
- Başlangıç portu 8876; doluysa otomatik artan port fallback.
- Tarayıcı yalnız sunucu başarıyla listen ettikten sonra açılır.
- Tüm yerel statik kaynaklarda `Cache-Control: no-store`.
- HTML doğrudan açılışında şebeke verileri için JS fallback eklendi.
- Esri tile görsellerinde gereksiz `crossOrigin` kaldırıldı; tile hatasında OSM fallback eklendi.
- Sürüm ve çalışma modu üst çubukta görünür.
