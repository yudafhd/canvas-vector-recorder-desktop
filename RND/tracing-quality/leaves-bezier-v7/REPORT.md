# Guard fitting Bézier — leaves

Sumber, hash engine, pengaturan dan renderer dicatat di [metrics.json](metrics.json). Baseline adalah snapshot `before-bezier-guard.ts` (v6). Palet, segmentasi, penghalusan raster, biaya fixed-end dan keputusan merge/swap tidak berubah.

## Hasil

| Ukuran | Sebelum | Sesudah |
| --- | ---: | ---: |
| Galat RGB seluruh gambar | 2.758641 | 2.595946 |
| Galat RGB piksel tepi | 22.030582 | 19.095216 |
| Segmen | 1470 | 1959 |
| Kontur | 171 | 171 |
| Ukuran SVG byte | 66903 | 88968 |

Galat tepi turun 13.32%. 240 fragmen memakai hasil refit. Deviasi maksimum terukur dari kurva ke polyline berubah 0.797797 → 0.764693 px. Nilai ini bukan jarak ke gambar sumber. Kontur tidak bertambah, tetapi segmen bertambah; batas perbaikan lokal bukan jaminan jumlah segmen global tetap.

## Mekanisme dan batas

`curveDeviation` memeriksa titik di antara sampel fitting, dengan jumlah langkah berdasarkan panjang control polygon (sekitar empat per piksel, minimum 4, maksimum 2048 per kurva). Jarak dihitung ke segmen polyline kontur. Ini sampled directional distance, bukan Hausdorff dua arah atau batas error kontinu yang terbukti.

Jika deviasi > min(tolerance, 0,35 px), kandidat refit memakai tolerance 0,75 × batas tersebut. Kandidat diterima hanya jika deviasi turun dan jumlah segmennya ≤ 2 × jumlah sebelumnya + 2. Endpoint dan arah tangen luar tetap dipakai; refit membagi rentang memakai tangen bersama. Ini **adaptasi ekspor aplikasi**, bukan mekanisme baru yang terbukti dari binary VM. Biaya riset untuk merge/swap tidak diubah.

Masih bisa ada deviasi di atas 0,35: refit dibatasi jumlah segmen dan kandidat tidak selalu mengurangi overshoot. Perbandingan raster dilakukan offline pada SVG akhir; belum ada acceptance objective raster per kandidat dalam runtime. Penurunan MAE bukan bukti kesetaraan dengan Vector Magic atau jaminan semua gambar membaik.

Renderer: flattening cubic 0,04 px, supersampling 4×4. Pemeriksaan visual tiga panel menunjukkan bentuk utama tetap; perbedaan lebih mudah dinilai dengan zoom. Waktu di metrics hanya satu run, sebagian proses berjalan bersamaan, sehingga tidak dipakai untuk klaim performa.

## Reproduksi

```sh
node tests/tracing-local-quality.mjs RND/tracing-quality/leaves-research-v4/source.bmp RND/tracing-quality/leaves-bezier-v7 RND/tracing-quality/before-bezier-guard.ts RND/tracing-quality/leaves-bezier-v7/settings.json
```

[Perbandingan interaktif](comparison.html) · [SVG hasil](after.svg)
