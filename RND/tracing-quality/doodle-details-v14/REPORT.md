# Doodle: perlindungan detail kecil (v14)

Keluhan: celah krem di lipatan pita hilang pada SVG UI yang disediakan pengguna. Salinan ekspor asli ada di `ui-provided.svg`. Source JPEG asli berukuran 2048 × 1152; viewBox ekspor 1024 × 576.

## Penyebab yang direproduksi

Pada pipeline offline sebelum perbaikan, beberapa region krem berukuran 13–17 piksel bertahan sampai tahap transisi warna, tetapi berubah label saat `cleanRegions` memakai ambang luas 24. Area kecil saja sebelumnya cukup untuk menggabungkan region ke tetangga. Ini menghilangkan detail lipatan sebelum fitting kurva. Tetangga pengganti tidak selalu hitam; perubahan berantai juga dapat memilih putih.

## Perubahan

`ADAPTER-SMALL-DETAIL` menjaga region minimal 3 piksel ketika setidaknya max(2, ceil(luas/4)) sampel opaque mendukung warna region: galat RGB kuadrat terhadap warna asli ≤1024 dan penggantian menambah galat >1024. Sampel memakai raster masukan sebelum pengubahan label. Singleton dan region dua piksel tetap dapat dibersihkan. Aturan generik ini juga dapat mempertahankan bintik kecil yang memang ada pada sumber.

Ini pendekatan implementasi kita, bukan ambang atau mekanisme Vector Magic yang telah diverifikasi. Tidak ada modifikasi SVG manual untuk menyembunyikan masalah.

## Hasil dan batas validasi

Pengaturan reproduksi: maksimum 15 warna, tolerance 0.8, minArea 24, smoothing aktif, putih dipertahankan. Pengaturan ekspor UI pengguna tidak diketahui lengkap. Resize memakai sips; tidak dianggap identik dengan Canvas UI.

- Komponen krem kecil (<100 piksel) dengan seed dalam ROI lipatan x76…108, y328…346: 1 → 5 sesudah seluruh cleanup.
- Galat RGB rata-rata seluruh gambar: 2.50818 → 2.40342.
- Galat RGB rata-rata tepi: 16.44729 → 15.59490 (turun 5.18%).
- Kontur: 208 → 227; segmen: 2181 → 2322. Detail dipertahankan dengan konsekuensi SVG lebih besar.
- Regresi shipping: galat tepi 17.46481 → 17.44965; kontur 117 → 119.
- 61 tes frontend lulus; pemeriksaan TypeScript dan build lulus. Tes tambahan memastikan tiga slot krem 2×8 piksel tetap terpisah pada ambang cleanup 24.

`comparison.html` membedakan ekspor UI pengguna, baseline offline, dan hasil offline baru. Perbaikan masuk engine yang dipakai worker UI, tetapi hasil trace UI baru belum divalidasi. Metrik bukan perbandingan dengan keluaran Vector Magic, dan tidak menjamin seluruh celah kecil yang sudah hilang saat resize dapat dipulihkan.
