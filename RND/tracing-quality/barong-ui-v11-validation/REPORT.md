# Validasi SVG UI setelah perbaikan garis

Kedua file merupakan SVG hasil ekspor UI yang diberikan pengguna. `before.svg` adalah salinan yang disimpan saat diagnosis sebelumnya; `after.svg` adalah file baru yang dibaca dari path Downloads yang disebut eksplisit. Hash dalam validation.json memastikan keduanya berbeda.

| Ukuran | UI sebelumnya | UI baru |
| --- | ---: | ---: |
| Path | 57 | 57 |
| Garis L | 36 | 41 |
| Cubic C | 1805 | 1792 |
| Total segmen | 1841 | 1833 |
| Ukuran byte | 87568 | 87033 |
| RMS kelengkungan lokal sisi kiri lidah (px proses) | 0,263036 | <1e-12 |
| RMS kelengkungan lokal sisi kanan lidah (px proses) | 0,290379 | <1e-12 |

Ruas celah lidah pada rentang y=530…590 viewBox sekarang berupa garis lurus. Pengukuran menggunakan x(y) dari SVG dan residual terhadap regresi garis, bukan screenshot atau hasil sips. Geometri sumber raster tidak diperlukan untuk mengukur kelurusan ini. Ini memvalidasi perbaikan lokal pada hasil UI yang nyata; bukan klaim seluruh gambar atau seluruh pipeline identik dengan hasil offline.

Arah tangen pada sambungan ruas terkait dihitung dari control point SVG sebelum/sesudah garis; nilai sudut masuk/keluar tercatat di validation.json. Penyimpangan kecil dapat berasal dari pembulatan koordinat ekspor 0,001 px. Pemeriksaan ini tidak menjamin C2 continuity atau semua sambungan gambar mulus.

Batas: tidak ada piksel Canvas UI maupun konfigurasi tertanam dalam SVG, sehingga galat terhadap raster, identitas pengaturan/versi dan kualitas seluruh lengkungan belum diukur ulang. Jumlah path tetap tidak membuktikan topologi selalu identik. Tidak ada perubahan engine pada tahap validasi ini.

Reproduksi pengukuran lokal: `python3 RND/tracing-quality/barong-ui-v11-validation/measure-lines.py`. File tersebut menyimpan sampel dan hasil dalam line-metrics.json.

[Perbandingan SVG UI dengan zoom lidah](comparison.html) · [SVG UI baru](after.svg) · [Kelurusan](line-metrics.json) · [Sambungan dan hash](validation.json)
