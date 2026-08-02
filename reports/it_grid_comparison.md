# IT OSM şebeke veri karşılaştırması

Oluşturulma: `2026-08-02T01:09:56.835970Z`

| Metrik | ArcGIS fresh | Validated union |
|---|---:|---:|
| fileSizeBytes | 14669629 | 18055992 |
| rawFeatureCount | 15105 | 19588 |
| validLineCount | 15101 | 15101 |
| validSubstationCount | 4 | 4487 |
| grid400LineCount | 1874 | 1874 |
| grid154LineCount | 13227 | 13227 |
| outsideBoundaryCount | 0 | 0 |
| invalidGeometryCount | 0 | 0 |
| duplicateCount | 0 | 0 |
| voltageParseFailureCount | 0 | 0 |
| voltageFieldMismatchCount | 0 | 0 |
| nameLineCount | 5125 | 5125 |
| refLineCount | 5508 | 5508 |
| operatorLineCount | 1295 | 1295 |
| osmTimestampCoverageRatio | 1.0 | 1.0 |
| suspectedGapTileCount | 0 | 0 |
| danglingEndpointRatio | 0.454784 | 0.454784 |
| failedRequests | 0 | 0 |
| partial | False | False |
| productionGatesPassed | True | True |

## Overpass doğrulama ve tamamlama

Ham feature: `4483` · geçerli TM: `4483` · failed requests: `0` · partial: `false`.

Overpass ülkenin tamamını tek sorguyla çekmek için değil, ArcGIS Structures katmanının atladığı polygon/way trafo merkezlerini küçük tile'larla doğrulamak ve tamamlamak için kullanıldı.

## Seçim

Seçilen dosya: `validated-union`

ArcGIS hat/nokta verisi ile küçük tile'lı Overpass polygon/way TM tamamlamasının OSM kimliği ve türü üzerinden tekilleştirilmiş birleşimi bütün production kapılarını geçti.

## Validated union

ArcGIS hat/nokta verisi ile küçük tile'lı Overpass polygon/way TM tamamlamasının OSM kimliği ve türü üzerinden tekilleştirilmiş birleşimi bütün production kapılarını geçti.

## Kaynak boşluk analizi

ArcGIS hat katmanı ile validated union arasında belirgin 1° hat boşluğu bulunmadı; Overpass katkısı TM tamamlamasıdır.

## Coğrafi kapsam kontrolleri

| Bölge | Hat | TM |
|---|---:|---:|
| Kuzey İtalya | 6950 | 2189 |
| Orta ve Güney İtalya | 7654 | 2122 |
| Sicilya | 1286 | 346 |
| Sardinya | 445 | 153 |

## Runtime dağıtım boyutu

Ham: `20927061` bayt · gzip: `3574323` bayt · Brotli: `3491368` bayt.
