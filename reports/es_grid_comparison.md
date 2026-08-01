# ES OSM şebeke veri karşılaştırması

Oluşturulma: `2026-08-01T23:38:13.628319Z`

| Metrik | Mevcut | Yeni |
|---|---:|---:|
| fileSizeBytes | 24468823 | 11805099 |
| rawFeatureCount | 19116 | 11589 |
| validLineCount | 6287 | 8663 |
| validSubstationCount | 0 | 2926 |
| grid400LineCount | 855 | 1075 |
| grid154LineCount | 5432 | 7588 |
| outsideBoundaryCount | 12718 | 0 |
| invalidGeometryCount | 0 | 0 |
| duplicateCount | 0 | 0 |
| voltageParseFailureCount | 0 | 0 |
| voltageFieldMismatchCount | 111 | 0 |
| nameLineCount | 599 | 1306 |
| refLineCount | 0 | 36 |
| operatorLineCount | 2250 | 2666 |
| osmTimestampCoverageRatio | 0.328887 | 1.0 |
| suspectedGapTileCount | 0 | 0 |
| danglingEndpointRatio | 0.440671 | 0.415441 |
| failedRequests | None | 0 |
| partial | None | False |
| productionGatesPassed | False | True |

## Seçim

Seçilen dosya: `fresh`

Yeni indirme ülke sınırı, ham OSM voltage birimi, geometri, başarısız tile şeffaflığı ve deterministik deduplication production kapılarının tamamını geçti.

## Validated union

Birleşim adayı ölçüldü: 6287 ortak, 5302 yalnız yeni, 0 yalnız eski feature. Yeni indirme tam ve şüpheli gap içermediği için silinmiş/değişmiş olabilecek eski OSM feature'ları production'a geri eklenmedi; fresh veri seçildi.

## Önceki alternatif İspanya adayı

Feature: `1770` · complete: `false` · dağılım: `{"substation": 1767, "cable": 3}`

Eksik AC hat katmanı nedeniyle ana production kaynağı olarak kullanılmadı; yalnız ikincil doğrulama adayıdır.

## Önceki boşluk koordinatları

| Merkez | Mevcut hat | Yeni hat | Fark |
|---|---:|---:|---:|
| 37.5000, -6.5000 | 84 | 341 | 257 |
| 36.5000, -5.5000 | 0 | 232 | 232 |
| 36.5000, -4.5000 | 0 | 225 | 225 |
| 38.5000, -1.5000 | 0 | 216 | 216 |
| 37.5000, -3.5000 | 72 | 272 | 200 |
| 37.5000, -5.5000 | 111 | 296 | 185 |
| 36.5000, -6.5000 | 0 | 169 | 169 |
| 37.5000, -1.5000 | 59 | 222 | 163 |
| 37.5000, -4.5000 | 124 | 281 | 157 |
| 37.5000, -0.5000 | 0 | 111 | 111 |
| 38.5000, -0.5000 | 29 | 101 | 72 |
| 36.5000, -3.5000 | 0 | 67 | 67 |
| 39.5000, -1.5000 | 30 | 96 | 66 |
| 37.5000, -7.5000 | 0 | 57 | 57 |
| 38.5000, -6.5000 | 54 | 100 | 46 |
| 36.5000, -2.5000 | 70 | 116 | 46 |
| 38.5000, -2.5000 | 25 | 42 | 17 |
| 38.5000, -7.5000 | 0 | 14 | 14 |
