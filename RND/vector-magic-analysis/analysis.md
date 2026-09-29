# Analisis statis Vector Magic Desktop 1.21

Tanggal pemeriksaan: 28 September 2026. Analisis utama memakai paket macOS lokal; installer dan aplikasi tidak dijalankan. Pada tahap pertama MSI hanya diperiksa format/metadata dan hash. Pemeriksaan lanjutan telah mengekstrak engine Windows dan membandingkan struktur; lihat [deep-analysis.md](deep-analysis.md). Kesamaan output kedua platform belum diuji.

## Identitas dan metode

- macOS SHA-256: `25f4a940725237b6e4b89767f4d3f527af3a6452c755bee154153b3de2f696de`.
- Windows SHA-256: `b3284ee80485a480d65aac5cf57d4feba8d28d2f2a309cdc872d9159971119ab`.
- PKG diekstrak menggunakan `xar`, Payload menggunakan `bsdtar`, ke `/private/tmp/vm-analysis-mac`.
- Executable: `Applications/Vector Magic/Vector Magic.app/Contents/MacOS/Vector Magic` dalam payload.
- Pemeriksaan: `file`, `otool -L`, `nm -C`, `strings -a`, dan `objdump --macho --arch=x86_64 --disassemble --demangle`.
- Binary universal x86_64 dan arm64. Banyak simbol C++ masih tersedia. Alamat bukti berikut berasal dari slice x86_64 dan bukan alamat runtime yang sudah terkena ASLR.
- Dependensi langsung mencakup Qt 6.8.3, Accelerate, OpenGL, libc++, dan framework sistem. Modul inti berada dalam executable utama; tidak ditemukan dylib vectorizer terpisah dalam dependency list langsung.
- Release notes paket menyatakan versi 1.21 dirilis 2 Juni 2026, dengan port Qt 6.8. Ini pernyataan file paket, bukan verifikasi asal atau keaslian installer.

## Rekonstruksi arsitektur

Urutan konseptual yang didukung nama modul dan antarmuka UI:

```text
Raster
  → klasifikasi gambar / pemilihan parameter
  → preprocessing dan pencarian palet
  → segmentasi region, termasuk penanganan subpixel
  → pelacakan batas region
  → optimasi posisi kontur
  → fitting kurva Bézier
  → ekspor vector
```

Ini bukan call graph lengkap. Mode gambar dan pengaturan dapat mengubah cabang serta pengulangan proses.

| Tahap | Bukti langsung | Makna / batas interpretasi |
|---|---|---|
| Klasifikasi | `ParameterClassifier::classifyImage`, `classifyParameters`, `computeEdgeProfileFeature`; preset `EP_LOGO_*`, `EP_LOGO_*_AA`, `EP_PHOTO_*` | Ada klasifikasi dan preset logo, logo anti-aliased, serta foto. Rumus klasifikasi belum direkonstruksi. |
| Palet | `PaletteFinder::doHistogram`, `doKMeans`, `findOptimalNumColors`, `computeWeightedMeanColors`; `cost_per_color` | K-means dan pemilihan jumlah warna memang hadir. Ruang warna, inisialisasi, dan fungsi biaya persis belum dibuktikan. |
| Segmentasi | `PixelSegmenter::preSegmentation`, `overSegmentation`, `mergeAndSwapLoop`, `computeMergeMetric`, `swapPixel`, `enforceMinNumPixels` | Ada penggabungan region dan perpindahan pixel berdasarkan metrik. Bukan bukti penggunaan graph-cut atau algoritma bernama tertentu. |
| Subpixel / artefak | `SubPixelSegmenter::splitAndMergeBeaches`, `flagShadowSegments`, `splitAndMergeFlaggedSegmentsFromBlurryImage`, `snapColorsToPalette`; UI anti-aliasing artifact rejection | Ada pemrosesan khusus area transisi/blur dan penyelarasan ke palet. Arti matematis “beach” belum diketahui. |
| Batas | `BoundaryTracer::traceBoundary`, `enumerateBoundaryNodes`, `removeRedundantNodes` | Batas region dibentuk menjadi node sebelum tahap berikutnya. |
| Kontur | `ContourSmoother::findPotential`, `findGradient`, `initializeConjugateGradientData`, `punctureCorners`, prior angular/quadratic | Ada optimasi kontur dengan conjugate gradient dan perlakuan sudut. Parameter mencakup penalti panjang serta anti-inversion. |
| Model gambar | `GenerativeModel::render`, `computePixelColor`, `findPotential`, `findGradient`, `checkFlaggedRegionsForInversions` | Sangat mendukung model rendering/geometri yang dipakai untuk evaluasi dan optimasi. Tidak berarti model AI generatif modern. |
| Bézier | `fitBezierCurve(sla::BezierCurve<double, 2, 3>&, ...)`, `findHessianAndGradient`, `mergeAndSwapLoop`, `computeMergeMetric` | Bézier kubik 2D, optimasi numerik, dan pengaturan pembagian fragmen tersedia. Fungsi objektif persis belum direkonstruksi. |

## Bukti hubungan antarmodul dari disassembly

Pada alamat `0x1000c5420`, di dalam rentang `ContourSmoother::findPotential()` (`0x1000c4e40` hingga sebelum `0x1000c5580`), terdapat pemanggilan langsung:

```text
callq GenerativeModel::findPotential()
```

Ini memperkuat hubungan model gambar dengan optimasi kontur, tetapi belum membuktikan cabang tersebut aktif pada setiap preset.

Worker thread juga memanggil controller masing-masing:

```text
0x100056da1 → VmController::segmentImage(...)
0x100056dd1 → VmController::contourSmoothImage(...)
0x100056e01 → VmController::bezierFitImage(...)
```

## Apa yang mungkin menentukan kualitasnya

Inferensi: kualitas kemungkinan bergantung pada gabungan segmentasi yang memahami transisi warna anti-alias, perbaikan artefak region, optimasi posisi batas, perlakuan sudut, dan penyederhanaan fragmen Bézier. Fitting kurva hanyalah salah satu tahap.

Model konseptual yang masuk akal adalah mencari bentuk yang cocok dengan raster sambil memberi penalti pada kontur atau kompleksitas yang tidak diinginkan. Bentuk persamaan, bobot, dan strategi optimasi lengkap belum dibuktikan; tidak boleh dipresentasikan sebagai rumus asli Vector Magic.

Binary memuat blok konfigurasi numerik dan beberapa preset. Contoh salah satu blok: `Segmenter::max_iterations=50`, `PaletteFinder::cost_per_color=0.15`, dan `ContourSmoother::phase_0.cg_max_iter=200`. Nilai ini bukan jaminan default global atau nilai aktif untuk input tertentu.

## Library pendukung

- ANN 1.1.1 dikonfirmasi oleh `Notes/license_ann.txt` dan simbol ANN kd-tree. ANN di sini berarti **Approximate Nearest Neighbors**, bukan Artificial Neural Network.
- Import `_dgemm_`, `_dgemv_`, `_dgesv_` serta Accelerate mendukung adanya operasi aljabar linear numerik. Penggunaan spesifik setiap routine belum dipetakan ke semua pemanggil.
- Qt menangani antarmuka dan fasilitas aplikasi. Keberadaan QtSvg tidak menjadikan QtSvg mesin raster-to-vector.
- Bukti yang diperiksa tidak cukup untuk menyatakan engine berbasis deep learning, menggunakan Potrace, atau tidak memiliki komponen tersebut sama sekali.

## Implikasi untuk pengembangan engine sendiri

Desain eksperimen yang relevan dari temuan ini adalah memisahkan pencarian palet, segmentasi/topologi, optimasi kontur, dan fitting kurva. Uji khusus logo dengan/ tanpa anti-alias, detail kecil, sudut tajam, lubang, serta pertemuan beberapa warna. Sediakan kontrol terpisah untuk kompleksitas region, smoothness, dan jumlah node; UI paket ini memang membedakannya.

Ini arahan desain dari analisis, bukan implementasi ulang engine yang sudah tervalidasi. Belum dilakukan benchmark, eksekusi engine, dekompilasi penuh, atau reproduksi output. Source code asli dan formula lengkap tidak dapat diklaim pulih dari pemeriksaan ini.

## Bukti pendamping

- `engine-symbols.txt`: simbol terpilih beserta alamat.
- `engine-parameter-names.txt`: nama parameter internal yang diekstrak.
- Dump lengkap dan payload sementara: `/private/tmp/vm-analysis-mac` (dapat hilang saat pembersihan temporary files).
