# Cekungan dangkal pada gigi — v13

Screenshot pengguna menunjukkan sisi gigi tertarik ke dalam. Pemeriksaan SVG UI yang telah disimpan menunjukkan perubahan arah pada sisi gigi. Probe pipeline raster offline (`contours.json`) memperlihatkan lekukan sudah ada sebelum fitting: sisi gigi kiri mengikuti kolom x=480 lalu 481 dan kembali ke sudut terlindungi (480,481). Ini membuktikan kontribusi kontur pada reproduksi offline, bukan kepastian bahwa seluruh cekungan UI berasal dari tahap yang sama.

## Perubahan

`regularizeShallowDents` diterapkan setelah smoothing raster, sebelum classifier corner dan fitting. Hanya kontur tertutup hampir cembung yang memenuhi syarat: minimal 12 sampel, luas ≥64 piksel², selisih luas hull dan kontur ≤1%. Pada chord hull sepanjang ≥8 piksel, sampel interior boleh diproyeksikan ke chord jika monotone, jarak ≤0,65 piksel dan tidak melintasi corner yang sudah dilindungi. Endpoint dan corner tidak digeser. Lekukan besar, kontur terbuka, bidang kecil dan bentuk yang jauh dari cembung dilewati. Semua aturan adalah **adaptasi bentuk**, bukan mekanisme VM terverifikasi atau detektor semantik gigi. Lekukan asli yang sangat dangkal masih bisa ikut diratakan.

Pass ini tidak mengganti seluruh kontur dengan convex hull. Tidak ada penambahan area tanpa batas. Namun batas hull/correction saja bukan sertifikat topologi untuk semua input. Energi `rasterEnergyBefore/After` masih mencatat tahap smoothing sebelum regularisasi ini; penurunan energi tersebut bukan bukti hasil akhir lebih akurat.

## Hasil pengujian

Luas cekungan didefinisikan sebagai luas convex hull kurva tersampling dikurangi luas kurva, satuan piksel proses². Empat gigi diurutkan kiri→kanan:

| Gigi | Sebelum | Sesudah |
| --- | ---: | ---: |
| 1 | 4.561515 | 1.134886 |
| 2 | 0.076216 | 0.076216 |
| 3 | 0.117970 | 0.117970 |
| 4 | 5.426946 | 0.875608 |

Dua gigi samping berkurang sekitar 75% dan 84%; dua gigi tengah tidak berubah. Ini ukuran keteraturan bentuk, bukan bukti fidelity raster. Pada crop gigi, 41 dari 5504 piksel render berubah. Pemeriksaan visual menunjukkan cekungan berkurang, belum hilang sepenuhnya.

Kontur tetap 60, segmen tetap 1235. MAE RGB global 0.576392→0.578373; MAE tepi 8.219302→8.266355 (naik 0.57%). Regresi shipping juga mencatat kenaikan kecil: MAE tepi 17.433931→17.464811. Keuntungan perapian dibayar dengan sedikit perubahan dari raster sumber. Timing satu run tidak dipakai untuk klaim performa.

## Validasi dan batas

60 tes frontend, TypeScript compile, build produksi lulus. Tes tambahan memastikan cekungan kecil bisa diratakan, corner terlindungi tidak disentuh, lekukan besar dan kontur terbuka dilewati, arah traversal terbalik konsisten, serta input tidak dimutasi. Tes kelurusan lidah dan kontinuitas lingkaran tetap lulus.

Sumber pengujian adalah BMP 1024² dari sips yang sudah ada di workspace. Belum menguji ulang piksel Canvas UI setelah perubahan ini. Hasil setelah tracing ulang Tauri perlu dibedakan dari perbandingan offline berikut.

```sh
node tests/tracing-tooth-probe.mjs RND/tracing-quality/barong-lines-v10/source.bmp RND/tracing-quality/barong-teeth-v13 RND/tracing-quality/before-tooth-guard.ts RND/tracing-quality/barong-lines-v10/settings.json
node tests/tracing-local-quality.mjs RND/tracing-quality/barong-lines-v10/source.bmp RND/tracing-quality/barong-teeth-v13 RND/tracing-quality/before-tooth-guard.ts RND/tracing-quality/barong-lines-v10/settings.json
python3 RND/tracing-quality/barong-teeth-v13/measure.py
node tests/tracing-tooth-render.mjs
```

[Perbandingan zoom gigi](comparison.html) · [Metrik gigi](tooth-metrics.json) · [Metrik gambar](metrics.json)
