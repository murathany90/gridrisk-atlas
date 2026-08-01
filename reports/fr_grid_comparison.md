# FR OSM şebeke veri karşılaştırması

Oluşturulma: `2026-08-01T23:38:43.649645Z`

| Metrik | Mevcut | Yeni |
|---|---:|---:|
| fileSizeBytes | 70992070 | 37210193 |
| rawFeatureCount | 71639 | 41065 |
| validLineCount | 30731 | 36633 |
| validSubstationCount | 65 | 4432 |
| grid400LineCount | 7503 | 8804 |
| grid154LineCount | 23228 | 27829 |
| outsideBoundaryCount | 15969 | 0 |
| invalidGeometryCount | 0 | 0 |
| duplicateCount | 0 | 0 |
| voltageParseFailureCount | 0 | 0 |
| voltageFieldMismatchCount | 24874 | 0 |
| nameLineCount | 6005 | 7275 |
| refLineCount | 0 | 186 |
| operatorLineCount | 29976 | 35673 |
| osmTimestampCoverageRatio | 0.429878 | 1.0 |
| suspectedGapTileCount | 0 | 0 |
| danglingEndpointRatio | 0.356188 | 0.352728 |
| failedRequests | 14 | 0 |
| partial | True | False |
| productionGatesPassed | False | True |

## Seçim

Seçilen dosya: `fresh`

Yeni indirme ülke sınırı, ham OSM voltage birimi, geometri, başarısız tile şeffaflığı ve deterministik deduplication production kapılarının tamamını geçti.

## Validated union

Birleşim adayı ölçüldü: 30796 ortak, 10269 yalnız yeni, 0 yalnız eski feature. Yeni indirme tam ve şüpheli gap içermediği için silinmiş/değişmiş olabilecek eski OSM feature'ları production'a geri eklenmedi; fresh veri seçildi.

## Önceki boşluk koordinatları

| Merkez | Mevcut hat | Yeni hat | Fark |
|---|---:|---:|---:|
| 45.5000, -0.5000 | 1 | 707 | 706 |
| 44.5000, -0.5000 | 0 | 631 | 631 |
| 47.5000, -1.5000 | 103 | 614 | 511 |
| 47.5000, 7.5000 | 1 | 503 | 502 |
| 43.5000, 3.5000 | 1 | 466 | 465 |
| 43.5000, -0.5000 | 0 | 341 | 341 |
| 43.5000, 4.5000 | 410 | 693 | 283 |
| 47.5000, -2.5000 | 1 | 282 | 281 |
| 43.5000, 0.5000 | 51 | 305 | 254 |
| 42.5000, 2.5000 | 47 | 256 | 209 |
| 48.5000, -1.5000 | 208 | 412 | 204 |
| 43.5000, -1.5000 | 0 | 192 | 192 |
| 47.5000, 6.5000 | 326 | 498 | 172 |
| 45.5000, 0.5000 | 69 | 228 | 159 |
| 44.5000, 0.5000 | 124 | 280 | 156 |
| 46.5000, -1.5000 | 79 | 225 | 146 |
| 42.5000, -0.5000 | 0 | 104 | 104 |
| 42.5000, 0.5000 | 5 | 97 | 92 |
| 45.5000, -1.5000 | 6 | 36 | 30 |
| 44.5000, -1.5000 | 0 | 29 | 29 |
