# Apel: konsolidasi palet dan optimasi kontur subpiksel

Sumber: `RND/aset_jpg/757fc2ab58535227c9f6a57e26fce0fa.jpg`, 512 × 512. Pembanding: snapshot `../before-subpixel.ts` sebelum konsolidasi palet dan optimizer baru. Kedua engine menerima piksel dan pengaturan yang sama: maksimum 16 warna, toleransi 0,8, pembersihan 24 piksel, smoothing aktif, putih dipertahankan.

`comparison.png` menampilkan **sumber → sebelum → sesudah** dari kiri ke kanan. `after.svg` adalah hasil engine produksi yang sudah diperbaiki. Palet aktual berkurang karena warna tambahan di tepi JPEG digabung; warna hijau daun, cokelat tangkai, krem kilau, dan merah muda titik tetap ada.

| Ukuran | Sebelum | Sesudah |
| --- | ---: | ---: |
| Warna aktual | 15 | 6 |
| Kontur | 409 | 8 |
| Segmen | 1.983 | 56 |
| Ukuran SVG, byte | 60.780 | 2.671 |
| Galat RGB rata-rata | 0,5835 | 0,6009 |
| Galat RGB pada tepi | 20,7465 | 20,8959 |

Secara visual, kontur apel dan tangkai lebih teratur dan bidang transisi kecil berkurang. **Galat terhadap raster JPEG sedikit meningkat**, sehingga berkurangnya kontur/segmen tidak dipakai sebagai bukti peningkatan akurasi. Rasio ini tidak membuktikan kesetaraan dengan Vector Magic; tidak ada ground truth vektor maupun hasil ekspor Vector Magic untuk gambar ini.

Perubahan engine: gabungkan pusat palet yang hampir sama dan saring warna tanpa dukungan interior; estimasikan batas subpiksel dari campuran dua warna; optimasikan residual batas serta kelengkungan sebelum fitting Bézier. Rantai bersama diproses sekali. Sudut, simpul percabangan, dan batas kanvas dikunci. Pergeseran node optimizer dibatasi 0,85 piksel. Fungsi biaya dan parameter disusun mandiri.

Pembersihan dapat menggabungkan detail tipis berkontras rendah. Pilih **Bersihkan bintik: Mati** jika detail itu harus dipertahankan. Uji regresi meliputi transparansi, sudut tajam, cabang sempit, aksen warna interior, garis tipis berkontras tinggi, dan lingkaran antialias dengan galat geometris subpiksel.

## Reproduksi tanpa browser

`source.bmp` adalah hasil decode JPEG menggunakan `sips`; berkas ini disertakan agar kedua engine selalu menerima piksel yang sama. Decode sips dapat berbeda dari browser, sehingga angka ini tidak dibandingkan langsung dengan laporan Chrome sebelumnya. Rasterizer SVG independen meratakan cubic dengan toleransi 0,04 piksel dan memakai 4 × 4 sampel per piksel; antialias browser tidak diuji pada putaran ini. Hash engine/input dan pengaturan tersimpan di `metrics.json`.

```sh
node tests/tracing-local-quality.mjs RND/tracing-quality/apple-v3/source.bmp RND/tracing-quality/apple-v3 RND/tracing-quality/before-subpixel.ts RND/tracing-quality/apple-v3/settings.json
```

Validasi: TypeScript, 41 tes frontend termasuk 12 tes tracing, 24 tes Rust, dan build Vite berhasil. UI native Tauri belum diuji ulang pada putaran ini.
