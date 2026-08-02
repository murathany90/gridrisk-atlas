# PT OSM şebeke veri karşılaştırması

Oluşturulma: `2026-08-02T01:09:42.754690Z`

| Metrik | ArcGIS fresh | Validated union |
|---|---:|---:|
| fileSizeBytes | 3650576 | 4418863 |
| rawFeatureCount | 4126 | 5033 |
| validLineCount | 4126 | 4126 |
| validSubstationCount | 0 | 907 |
| grid400LineCount | 415 | 415 |
| grid154LineCount | 3711 | 3711 |
| outsideBoundaryCount | 0 | 0 |
| invalidGeometryCount | 0 | 0 |
| duplicateCount | 0 | 0 |
| voltageParseFailureCount | 0 | 0 |
| voltageFieldMismatchCount | 0 | 0 |
| nameLineCount | 1354 | 1354 |
| refLineCount | 785 | 785 |
| operatorLineCount | 3758 | 3758 |
| osmTimestampCoverageRatio | 1.0 | 1.0 |
| suspectedGapTileCount | 0 | 0 |
| danglingEndpointRatio | 0.360155 | 0.360155 |
| failedRequests | 0 | 0 |
| partial | False | False |
| productionGatesPassed | True | True |

## Overpass doğrulama ve tamamlama

Ham feature: `907` · geçerli TM: `907` · failed requests: `0` · partial: `false`.

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
| Kuzey iletim koridoru | 1716 | 341 |
| Porto çevresi | 950 | 136 |
| Lizbon çevresi | 888 | 195 |

## Runtime dağıtım boyutu

Ham: `5122513` bayt · gzip: `750750` bayt · Brotli: `721789` bayt.
