# Daun: integrasi mekanisme hasil riset ke engine

Input yang diminta: `RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png`, **830 × 584**, SHA-256 `a3c06767b8a76477c7c4abb33fd2b887fa0084895eda4ae1b67aa0a0f650dbfe`. Decode `sips` disimpan sebagai `source.bmp`; kedua engine menerima buffer yang sama. Snapshot pembanding: `../before-research-mechanisms.ts` (versi setelah optimasi subpiksel/palet, sebelum integrasi mekanisme riset pada putaran ini).

Opsi sama: maksimum **6 warna**, toleransi **0,8**, bintik **4 piksel**, smoothing aktif, putih dipertahankan. Resolusi input tidak diubah. Pemilihan 6 warna mengisolasi perubahan geometri dengan palet yang tetap; ini tidak menguji kecocokan semua warna/gradasi sumber.

## Artefak yang dapat diperiksa

- [Perbandingan interaktif dengan zoom](comparison.html): sumber/sebelum/sesudah dapat dipilih, batas tampilan dapat digeser.
- [Perbandingan PNG](comparison.png): **sumber → sebelum → sesudah**, kiri ke kanan.
- [SVG sesudah](after.svg), [SVG sebelum](before.svg), [metrik dan hash](metrics.json).
- [Peta bukti tiap tahap](../../../docs/TRACING-RESEARCH-MAP.md): kernel terverifikasi, adaptasi, pendekatan, dan bagian yang belum diterapkan.

## Hasil pengukuran

| Ukuran | Sebelum | Sesudah |
| --- | ---: | ---: |
| Warna aktual | 6 | 6 |
| Kontur SVG | 171 | 171 |
| Segmen SVG | 1.435 | 1.464 |
| Ukuran SVG, byte | 56.840 | 66.852 |
| Galat RGB rata-rata | 2,77303 | 2,76979 |
| Galat RGB tepi | 22,34155 | 22,24713 |

Galat tepi turun sekitar **0,42%** pada rasterizer ini. Perubahan visual kecil, bukan lompatan kualitas. Segmen dan ukuran berkas meningkat; penurunan galat tidak dicapai hanya dengan mengurangi jumlah node. Palet dan jumlah kontur tetap, sehingga perubahan ini terutama menyangkut geometri/fitting. Jumlah kontur SVG yang sama tidak membuktikan seluruh topologi kurva kontinu tetap identik.

## Mekanisme yang benar-benar berjalan

Diagnostics produksi pada input ini mencatat:

| Peristiwa | Jumlah |
| --- | ---: |
| Unit fragments awal | 20.999 |
| Merge diterima | 20.076 |
| Swap diterima | 3.078 |
| Anchor corner tambahan dari classifier | 12 |
| Fragment dengan adapter refit tangen | 660 |

Biaya self/merge/swap memakai solver endpoint tetap dan parameter chord yang tidak dioptimalkan ulang. Cabang n=0/1/2/3/≥4 serta regularisasi 1e-5 mengikuti temuan tahap 4; penalti ridge tidak ikut biaya merge. Merge dievaluasi sebelum swap −1, kemudian +1; ketaksamaan tetap ketat. Jadwal ambang dan rumus advanced complexity diterapkan, sementara pemetaan detail aplikasi ke complexity dan veto maksimum galat adalah adaptasi yang ditandai di kode.

Classifier corner memakai fitur tujuh titik hasil rekonstruksi dan pohon keputusan yang diperiksa terhadap disassembly. Keputusan batas lokal memakai urutan arah dan first-cell context tahap 7; siklus owner-node VM tetap belum direproduksi.

**Adapter tangen tetap aktif pada 660 fragment.** Artinya kernel riset sudah mengendalikan biaya/pemilihan fragmen, tetapi tidak semua kurva ekspor menggunakan kontrol fixed-end tanpa perubahan. Palet, cleanup warna, RGB measurement, optimizer satu pass, konektivitas dan layering SVG masih memakai mekanisme aplikasi sendiri. Tidak ada klaim bahwa seluruh ContourSmoother, GenerativeModel atau segmenter VM telah diimplementasikan.

## Validasi

`npm test`: TypeScript, **46 tes frontend** (17 tracing), **24 tes Rust** berhasil. Build Vite berhasil. Tes kernel mencakup tujuh kasus fitting, 1.036 vektor classifier dari interpreter disassembly, 32 jendela fitur, seluruh 12 posisi complexity dari tabel riset, prioritas merge/swap, jadwal, keputusan lokal, dan regresi bentuk/transparansi.

Golden vectors berasal dari interpreter penelitian dan solver dense 4×4/pivoted yang independen dari solver blok 2×2 TypeScript. Mereka memeriksa transkripsi dan rumus; aplikasi Vector Magic tidak dijalankan untuk memperoleh expected values. UI native Tauri dan antialias browser belum diuji ulang pada putaran ini.

Rasterizer pengukuran meratakan cubic hingga toleransi 0,04 piksel dan memakai 4 × 4 sampel per piksel. Galat RGB dihitung setelah komposit putih; tepi berasal dari perbedaan RGB kuadrat sumber terhadap tetangga kanan/bawah >1024 (25.549 piksel). Decode sips/render perangkat lunak dapat berbeda dari browser. Angka tidak dibandingkan langsung dengan laporan Chrome lama. Waktu dalam `metrics.json` adalah satu pengukuran lokal, bukan benchmark stabil.

Tidak ada SVG Vector Magic/ground truth kurva untuk daun ini. Hasil ini menunjukkan integrasi mekanisme terukur pada engine kita, bukan pembandingan kualitas dengan aplikasi target.

## Reproduksi

```sh
node tests/tracing-local-quality.mjs RND/tracing-quality/leaves-research-v4/source.bmp RND/tracing-quality/leaves-research-v4 RND/tracing-quality/before-research-mechanisms.ts RND/tracing-quality/leaves-research-v4/settings.json
```

`source.bmp` disertakan agar decode kedua engine identik. Jika memperbarui input:

```sh
sips -s format bmp 'RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png' --out RND/tracing-quality/leaves-research-v4/source.bmp
```
