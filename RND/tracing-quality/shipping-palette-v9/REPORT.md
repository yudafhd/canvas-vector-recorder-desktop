# Pemulihan warna interior — shipping doodle

Input asli `RND/aset_jpg/shipping-doodle.png` (2088×514), diproses menjadi 1024×252 melalui sips yang sama dengan v8. Pengaturan: maksimal 16 warna, minArea 4, tolerance 0,8, smoothing aktif, hapus putih mati. Baseline: `before-palette-interiors.ts`. Hash, decoder, metrik dan parameter tersedia dalam JSON di folder ini.

## Diagnosis

[Analisis tahap palet](region-analysis.json) menunjukkan pusat hijau sudah menjadi RGB sekitar (120,130,123) sejak quantize, sebelum compact palette. Pusat ini juga menampung piksel campuran tepi. Koreksi dari sampel sumber dengan lingkungan warna konsisten memulihkan warna hijau menjadi `#86986e` dari `#79827b`. Ini perubahan centroid label yang sudah ada, tanpa penambahan slot palet. Biru kotak tetap `#7892b3`, merah pita tetap `#d67764`; delapan warna lainnya pada hasil shipping tidak berubah.

## Implementasi

`refinePaletteInteriors` berjalan sesudah compact palette, sebelum koreksi transisi, hanya ketika pembersihan aktif. Sampel harus opaque dan memiliki ≥8 dari 9 piksel lingkungan dengan jarak RGB ≤18. Setiap centroid memerlukan ≥8 sampel pendukung; mean interior menggantikan centroid hanya bila pergeseran >18 RGB. Setelah ada koreksi, label opaque/binary-alpha yang sudah ada ditetapkan ulang ke pusat terdekat. Piksel berlabel transparan tidak diubah. Tidak menambah atau menghapus entri palet.

Seluruh aturan dukungan, threshold dan tahap ini merupakan **adaptasi aplikasi**, bukan objective PaletteFinder VM yang sudah direkonstruksi. K-means dan histogram lama tetap berjalan. Warna yang sudah hilang total atau tercampur beberapa bidang nyata ke satu pusat belum dapat dipulihkan oleh metode ini. Ini untuk ilustrasi warna datar; bukan jaminan untuk foto atau gradien.

## Hasil akhir

| Ukuran shipping | Sebelum | Sesudah |
| --- | ---: | ---: |
| MAE RGB | 2,581605 | 2,551713 |
| MAE RGB tepi | 16,188639 | 16,195914 |
| Kontur | 128 | 117 |
| Segmen | 1096 | 1032 |
| SVG byte | 47014 | 44192 |

Galat seluruh gambar turun 1,16%, sedangkan galat tepi naik 0,045%. Jadi hasil ini memulihkan warna interior dan mengurangi fragmen, tetapi tidak mengklaim seluruh aspek kualitas meningkat. Renderer offline memakai cubic flattening 0,04 px dan supersampling 4×4; tidak ada SVG ground truth VM.

Daun dan apel menghasilkan SVG yang identik byte demi byte dengan baseline. Tes sintetis memeriksa pemulihan bidang kecil, jumlah entri palet tetap, garis satu piksel, dan pengecualian alpha parsial/transparan. Seluruh 54 tes frontend (termasuk 25 tracing), compile TypeScript dan build produksi lulus. Waktu metrics adalah run tunggal dengan pekerjaan bersamaan, bukan benchmark performa.

## Reproduksi

```sh
node tests/tracing-local-quality.mjs RND/tracing-quality/shipping-regions-v8/source.bmp RND/tracing-quality/shipping-palette-v9 RND/tracing-quality/before-palette-interiors.ts RND/tracing-quality/shipping-palette-v9/settings.json
node tests/tracing-region-analysis.mjs RND/tracing-quality/shipping-regions-v8/source.bmp RND/tracing-quality/shipping-palette-v9 src/tracing/engine.ts RND/tracing-quality/shipping-palette-v9/settings.json
```

[Perbandingan dengan zoom](comparison.html) · [SVG hasil](after.svg) · [Metrik](metrics.json)
