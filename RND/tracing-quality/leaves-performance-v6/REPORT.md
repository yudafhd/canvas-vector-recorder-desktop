# Optimasi cakupan piksel — hasil tetap identik

Input daun 830 × 584 dan pengaturan v5 tetap sama. Buffer clipping segitiga digunakan ulang per objective; koordinat piksel patch dihitung sekali. Setelah langkah diterima, gradient dihitung dari prediksi kandidat yang sudah ada, tanpa menghitung ulang luas cakupannya. Urutan clipping, operasi floating point, bobot, ambang dan iterasi optimizer tetap sama.

| Pengukuran | Sebelum | Sesudah |
| --- | ---: | ---: |
| Median tracing empat run | 5172,92 ms | 2838,09 ms |
| SVG byte | 66903 | 66903 |
| Kontur | 171 | 171 |
| Segmen | 1470 | 1470 |

Waktu berkurang **45,14%**, atau **1,82× lebih cepat**. Setiap engine diberi satu warmup; empat pasangan pengukuran membalik urutan sebelum/sesudah. Yang diukur adalah `traceRaster` di Node, tanpa decode, renderer, atau startup aplikasi. Ini pengukuran mesin lokal dalam lingkungan pengembangan, bukan benchmark mesin terisolasi maupun pengukuran WebView Tauri.

Seluruh `TraceResult`, termasuk SVG byte dan diagnostik numerik, identik pada semua warmup/run. SHA-256 SVG `04b361c8bd0462571ecff103e77146ede05fd2551d898baf38ca9c5e7ba81f3f` juga identik dengan artefak v5. Karena SVG dan sumber identik, hasil pengukuran kualitas v5 tetap berlaku tanpa merasterisasi ulang.

384 kasus differential dengan seed tetap membandingkan prediksi empat kanal, energi dan gradient terhadap snapshot sebelum optimasi: loop maju/terbalik, posisi fractional/tepat kisi, alpha parsial, serta evaluasi berulang pada objective terpisah. Tes regresi rutin juga membandingkan clipping buffer dengan implementasi polygon referensi. Ini bukti kesamaan kasus yang diuji, bukan pembuktian formal semua input.

Validasi: TypeScript compile, build produksi, serta tes frontend termasuk 21 tes tracing. Tidak mengubah Rust atau mekanisme riset. Keterbatasan model dan optimizer v5 tetap berlaku.

## Reproduksi

```sh
node tests/tracing-performance.mjs RND/tracing-quality/leaves-research-v4/source.bmp RND/tracing-quality/leaves-performance-v6 RND/tracing-quality/before-coverage-performance.ts RND/tracing-quality/leaves-raster-v5/settings.json
```

[Angka mentah dan hash engine](benchmark.json) · [SVG hasil](after.svg) · [Perbandingan visual v5, hasil sama](../leaves-raster-v5/comparison.html)
