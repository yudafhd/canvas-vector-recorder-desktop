# Pemantauan runtime tanpa ekspor Vector Magic

Pengguna menyatakan bahwa edisi Vector Magic yang dipakai tidak mengizinkan penyimpanan SVG. Karena itu berkas SVG yang muncul pada uji sebelumnya memiliki asal yang belum terverifikasi; [laporan diagonal](../phase8-diagonal-findings.md) telah dikoreksi agar tidak mengatribusikan SVG tersebut ke mesin Vector Magic.

Pemantauan non-ekspor berhasil diuji pada proses macOS Vector Magic 1.21 (`pid 78389`, arsitektur x86-64): `/usr/bin/sample` dapat mengambil call stack aplikasi tanpa memodifikasi proses atau membuka fitur berbayar. [Sampel idle 1 detik](idle-stack-sample.txt) menunjukkan thread utama berada di `QCoreApplication::exec()` dan menunggu event, sementara thread thumbnail tidur. [Sampel 60 detik pertama](vectorization-stack-sample.txt) tidak menangkap pekerjaan mesin vektorisasi.

## Rekaman saat vektorisasi manual

Pada rekaman berikutnya, pengguna menjalankan vektorisasi ketika [sampel 120 detik](vectorization-stack-sample-live.txt) aktif. Call graph sekarang memuat thread dan rantai panggilan berikut:

| Tahap teramati | Bukti langsung pada call graph |
|---|---|
| Klasifikasi dan palet | `ClassifyImageThread` → `VmController::classifyImage` → `CoreEngine::classifyImage` → `ParameterClassifier::classifyImage` → `PaletteFinder::findPalettes` → `doKMeans` |
| Segmentasi | `SegmentationThread` → `VmController::segmentImage` → `Segmenter::execute` → `PixelSegmenter::overSegmentation` → `mergeAndSwapLoop` |
| Penelusuran batas dan smoothing | `ContourSmoothingThread` → `VmController::contourSmoothImage` → `ContourSmoother::execute` → `executeCurrentPhase` → `Optimizer::doCG` → `findPotential` → `GenerativeModel::findPotential`; `BoundaryTracer::execute` juga terlihat di tahap ini |
| Fitting Bézier | `BezierFittingThread` → `VmController::bezierFitImage` → `BezierFitter::execute` → `segmentContours` → `selectKeepers` → `mergeAndSwapLoop` → `considerMergeAndSwap` → `computeMergeMetric` / `computeSwapMetric` → `fitBezierCurve` |
| Render | `VectorRenderThread` hadir dalam sampel |

Ini adalah **bukti runtime langsung** bahwa jalur merge/swap pada segmentasi dan fitting Bézier dijalankan. Angka pada call graph adalah jumlah *sampel stack*, bukan hitungan pemanggilan fungsi atau durasi tahap. Dua thread dengan nama yang sama dapat muncul karena beberapa pekerjaan terjadi dalam jendela rekaman; sampel agregat tidak mempertahankan urutan waktu detail. Sampel juga tidak memuat nilai variabel lokal, biaya merge/swap, atau ambang keputusan, sehingga nilai tersebut masih memerlukan pengamatan yang lebih spesifik jika menjadi target riset.

Pengguna menyebut `RND/aset_jpg` sebagai folder aset yang divector. Folder ini sekarang memuat empat JPEG berikut; sampel call stack tidak mencatat nama file, sehingga belum ada pemetaan yang pasti dari tiap thread ke satu gambar atau preset.

| Aset | Ukuran | Motif |
|---|---:|---|
| [`0bc532eac697b88907841729b2b72a86.jpg`](../../aset_jpg/0bc532eac697b88907841729b2b72a86.jpg) | 1152×1024 | segitiga merah |
| [`3ab1424eff80b6359672d82fb8d5e4a4.jpg`](../../aset_jpg/3ab1424eff80b6359672d82fb8d5e4a4.jpg) | 1200×1200 | lingkaran merah bertepi hitam |
| [`5a03e635edf18aeeea8d449da76ab4e0.jpg`](../../aset_jpg/5a03e635edf18aeeea8d449da76ab4e0.jpg) | 353×353 | diagonal kuning–putih |
| [`757fc2ab58535227c9f6a57e26fce0fa.jpg`](../../aset_jpg/757fc2ab58535227c9f6a57e26fce0fa.jpg) | 512×512 | ikon apel |

JPEG diagonal adalah gambar asli yang diberikan pengguna dan baru tersedia setelah fixture PNG prosedural dibuat. Ia tidak identik piksel per piksel dengan fixture [`diagonal-yellow-white-353.png`](diagonal-yellow-white-353.png); pengukuran fixture dan JPEG perlu dipisahkan.

Log macOS uji sebelumnya hanya menampilkan aktivitas layanan sistem tanpa nama fase engine. Tangkapan layar pratinjau dapat dipakai untuk membandingkan hasil visual, tetapi tidak memberi koordinat Bézier, SVG, atau ambang merge/swap secara langsung.
