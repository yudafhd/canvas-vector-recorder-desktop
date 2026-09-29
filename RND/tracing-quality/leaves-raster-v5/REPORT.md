# Uji daun: model raster dan angular prior

Input asli: `RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png`, 830 × 584. Decode BMP yang sama dengan v4 dipakai agar hasil dapat dibandingkan. SHA input dan kedua engine tercatat di [metrics.json](metrics.json). Pengaturan: maksimal 6 warna, tolerance 0,8, minArea 4, smoothing aktif, hapus putih mati.

| Pengukuran | Sebelum (v4) | Sesudah (v5) |
| --- | ---: | ---: |
| MAE RGB seluruh gambar | 2,769788 | 2,758641 |
| MAE RGB piksel tepi | 22,247133 | 22,030582 |
| Kontur | 171 | 171 |
| Segmen | 1464 | 1470 |
| SVG (byte) | 66852 | 66903 |
| Waktu satu run (ms) | 1211 | 6004 |

Galat tepi turun 0,97%, seluruh gambar turun 0,40%. Perubahan visual kecil; ujung dan urat utama tetap terlihat. Jumlah kontur tidak berubah; ini tidak dengan sendirinya membuktikan semua detail/topologi identik. Ada 1267 langkah raster diterima dan 10 loop kecil memakai constraint area. Jumlah objective patch turun 451,02 → 425,40, tetapi bukan ukuran global SVG: patch bertumpang tindih dan fitting Bézier berlangsung sesudahnya.

Cakupan dihitung melalui clipping geometri, warna linear terhadap luas, energi setengah kuadrat residual empat kanal. Prior angular mengikuti rumus riset. Gradient diperiksa dengan central finite differences, termasuk rantai tertutup dan interior rantai terbuka. Optimizer per rantai, bobot angular 0,3, length 0,25, area 5, warm start dan guard tetap adaptasi. Mode hapus putih melewati refinement raster karena sumber berwarna putih bukan target transparan.

Batas: belum ada SVG acuan Vector Magic; tidak membuktikan kesetaraan dengannya. Renderer offline memakai cubic flattening 0,04 px dan supersampling 4×4, bukan renderer WebView. Waktu merupakan satu pengukuran lokal, belum benchmark berulang. Biaya proses naik sekitar lima kali; implementasi clipping perlu dioptimalkan sebelum menaikkan resolusi atau jumlah iterasi. Tidak mengklaim anti-inversion global VM sudah direproduksi.

Validasi: TypeScript compile, build, tes frontend/Rust, 20 tes tracing termasuk konservasi luas, gradient numerik, fitur kecil, kontinuitas kurva, sudut dan transparansi lulus.

## Reproduksi

```sh
node tests/tracing-local-quality.mjs RND/tracing-quality/leaves-research-v4/source.bmp RND/tracing-quality/leaves-raster-v5 RND/tracing-quality/before-raster-model.ts RND/tracing-quality/leaves-raster-v5/settings.json
```

[Buka perbandingan dengan zoom](comparison.html) · [SVG hasil](after.svg) · [Tiga panel](comparison.png)
