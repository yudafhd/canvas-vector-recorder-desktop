# Pembersihan region — shipping doodle

Sumber yang diminta: `RND/aset_jpg/shipping-doodle.png`, 2088 × 514. Pengujian menggunakan 1024 × 252 mengikuti batas resolusi proses UI; decode/resize melalui sips, sehingga tidak dijamin identik piksel dengan browser. Hash dan perintah tersedia di [source-manifest.json](source-manifest.json). Maksimal 16 warna, tolerance 0,8, minArea 4, smoothing aktif, hapus putih mati.

## Temuan dan hasil

Region awal: 15.750 sesudah quantize → 5.442 sesudah compact palette → 479 sesudah koreksi transisi → 135 sesudah pembersihan lama → 128 sesudah pass baru. Warna campuran di tepi menjadi banyak komponen terpisah; tidak semua komponen kecil boleh dihapus karena garis dekoratif, pita dan simbol gelas juga kecil.

Pass baru mereklasifikasi 29 piksel dari 7 komponen. SVG turun 48.608 → 47.014 byte. Galat tepi turun sekitar 0,13%; perubahan visual kecil. Sembilan warna tetap dipertahankan. Detail besar terlihat tetap, tetapi klaim semua detail utuh memerlukan ground truth; jumlah kontur saja bukan bukti topologi.

| Gambar | Kontur | Segmen | MAE RGB | MAE RGB tepi |
| --- | ---: | ---: | ---: | ---: |
| shipping | 135 → 128 | 1128 → 1096 | 2.583749 → 2.581605 | 16.209072 → 16.188639 |
| leaves | 171 → 153 | 1959 → 1875 | 2.595946 → 2.595451 | 19.095216 → 19.082234 |
| apple | 8 → 8 | 79 → 79 | 0.530877 → 0.530877 | 15.943643 → 15.943643 |

Apel menghasilkan SVG byte-identik dengan baseline. Daun juga memiliki lebih sedikit kontur dan galat sedikit lebih rendah. Timing merupakan satu run lokal dengan beberapa pekerjaan bersamaan; tidak dipakai untuk klaim percepatan.

## Mekanisme dan batas bukti

`cleanTransitionRegions` berjalan setelah cleanup lama dan sebelum penghapusan putih. Identitas region dan tetangga dihitung pada snapshot label. Kandidat: luas ≤ max(16, 8×minArea), tanpa inti dengan ≥8 dari 9 piksel sama. Dua region tetangga harus cukup besar (> max(32, 8×minArea, 4×luas kandidat)) dan berbagi minimal dua sisi. Transparansi parsial tidak direklasifikasi.

Setiap piksel kandidat harus cocok dengan campuran dua warna tetangga: separation RGB² ≥4000, koefisien 0,05…0,95, residual RGB² ≤300. Total galat warna label lama harus >64 per piksel, dan campuran harus memperbaikinya >25 per piksel. Kandidat dengan warna asli yang sudah cocok dipertahankan. Piksel dipindahkan ke sisi campuran dominan. Daftar koordinat perubahan tersedia di [region-analysis.json](region-analysis.json).

Semua threshold, aturan dukungan dan keputusan ini **adaptasi aplikasi**, bukan total biaya/ambang merge region Vector Magic yang sudah terverifikasi. Model campuran menjelaskan sumber, tetapi itu tidak membuktikan secara semantik bahwa sebuah fitur adalah artefak. Garis tipis dengan warna asli dekat campuran tetap kasus ambigu; pemeriksaan konservatif dan tes hanya mengurangi risiko. Pass dinonaktifkan saat pembersihan mati. Cleanup lama tetap punya kebijakan penghapusan region kecil sendiri.

Perubahan ini tidak menyelesaikan pemilihan palet: warna hijau di bagian dalam kardus masih bergeser ke abu-abu kehijauan pada baseline dan hasil baru. Perbaikan palet membutuhkan pekerjaan terpisah.

## Validasi dan reproduksi

23 tes tracing termasuk kasus artefak campuran, detail exact-color, bintik terisolasi, alpha parsial, mode mati, sudut, garis tipis, dan kontinuitas kurva. Pemeriksaan TypeScript, seluruh frontend dan build produksi juga dijalankan. Renderer kualitas memakai flattening cubic 0,04 px dan supersampling 4×4; belum ada SVG ground truth VM.

```sh
node tests/tracing-region-analysis.mjs RND/tracing-quality/shipping-regions-v8/source.bmp RND/tracing-quality/shipping-regions-v8 src/tracing/engine.ts RND/tracing-quality/shipping-regions-v8/settings.json
node tests/tracing-local-quality.mjs RND/tracing-quality/shipping-regions-v8/source.bmp RND/tracing-quality/shipping-regions-v8 RND/tracing-quality/before-region-refinement.ts RND/tracing-quality/shipping-regions-v8/settings.json
```

[Perbandingan dengan zoom dan lokasi perubahan](comparison.html) · [SVG hasil](after.svg) · [Metrik](metrics.json)
