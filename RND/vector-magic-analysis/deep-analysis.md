# Pemeriksaan lanjutan engine Vector Magic 1.21

Pemeriksaan lokal statis, 28 September 2026. Fokus: alur panggilan, beberapa fungsi biaya, dan perbandingan paket Windows/macOS. Installer, EXE, dan DLL tidak dieksekusi.

## Hasil terpenting

1. Windows menyediakan **engine_project.dll** terpisah. EXE utamanya mengimpor DLL tersebut. macOS mengandung modul engine di executable utama.
2. Semua **107 nama parameter** yang dicocokkan ditemukan pada kedua engine. Semua **221 nama metode unik** dalam 10 kelas inti yang dipilih juga cocok. Ini bukti kuat kesamaan struktur, bukan bukti output atau implementasi identik.
3. Model gambar memakai rekonstruksi warna berbobot luas dan error kuadrat empat kanal. Hubungannya dengan penghalusan kontur terbukti dari pemanggilan fungsi potential dan gradient.
4. Beberapa fungsi biaya kini dapat dijelaskan secara matematis dari instruksi, dengan batas interpretasi yang disebutkan di bawah.

## Windows: engine benar-benar terpisah

MSI merupakan compound file. CAB diekstrak dengan membaca FAT/stream container menggunakan Python standard library, lalu CAB dibuka dengan bsdtar. Tidak ada software tambahan yang diinstal.

| Komponen | Identifikasi |
|---|---|
| CAB | stream directory ID 41, ukuran 23.903.217 byte |
| EXE utama | CAB member `flsEZqUnPw53GCrVkm5KVEvVZTG3KQ`, 2.705.312 byte |
| Engine | CAB member `flspRShS48._AE72tYVNfmG6ehA9u0`, export DLL name `engine_project.dll` |
| Engine format | PE32+, x86-64, DLL |
| Engine ukuran | 812.448 byte |
| Engine SHA-256 | `4fe299be39a95230f713623d2f8494082bee402b87e61d49e4250bafff9188f4` |
| Export table | 1.075 entri bernama, termasuk fungsi/data/template; bukan 1.075 API publik yang stabil |
| Import engine | `ann.dll`, `blas.dll`, `formats.dll`, runtime GCC/C++, KERNEL32, msvcrt |

Import table EXE memuat engine_project.dll dan Qt6Core/Gui/Network/Widgets. Import langsung engine_project.dll tidak memuat Qt. Jadi, pada Windows, pembagian UI dan core numerik terlihat secara fisik dalam distribusi ini.

Export C++ menyediakan banyak nama internal yang berguna untuk analisis. Keberadaan export tidak membuktikan adanya SDK, ABI stabil, atau prosedur penggunaan standalone. Belum diuji inisialisasi, kepemilikan memori, dependensi runtime, dan pemanggilan langsung engine.

Bukti: `windows-engine-pe.txt`, `windows-engine-exports.txt`, `windows-pe-manifest.json`.

## Perbandingan dengan macOS

- 107/107 nama parameter cocok, mencakup nama generik dan beberapa nama per-phase yang terdapat di strings.
- 221/221 nama metode unik cocok pada: CoreEngine, PaletteFinder, PixelSegmenter, SubPixelSegmenter, SuperPixelSegmenter, ContourSmoother, GenerativeModel, BezierFitter, BoundaryTracer, Optimizer.
- Pencocokan metode dilakukan pada **class::method**, tanpa membandingkan overload, ABI, isi instruksi, nilai parameter, atau hasil runtime.
- ANN dan fungsi numerik dgemm/dgemv/dgesv hadir pada kedua platform; cara pengemasannya berbeda.

Bukti: `parameter-comparison.json`, `method-comparison.json`.

## Alur panggilan yang telah terkonfirmasi

Alamat berikut berasal dari slice macOS x86_64, sebelum ASLR. Daftar panggilan tidak berarti semua cabang selalu dieksekusi.

```text
VmController::segmentImage
  → populateSettings
  → needsToSegment
  → ensureFlattened / Preprocessor::setPixels
  → Segmenter::execute

VmController::contourSmoothImage
  → populateSettings
  → needsToContourSmooth
  → BoundaryTracer::execute       [0x10011b740]
  → ContourSmoother::execute       [0x10011b756]

VmController::bezierFitImage
  → populateSettings
  → needsToBezierFit
  → BezierFitter::execute          [0x10011b930]
  → Exporter::generateCompoundCurves [0x10011b941]
```

Fungsi needsTo... membandingkan token pengaturan. Pada controller, hasil pemeriksaan dapat melewati pekerjaan inti. Inferensi: ini mendukung penggunaan ulang hasil tahap yang belum berubah. Batas invalidasi lengkap belum dipetakan.

`Segmenter::execute` memiliki cabang yang memanggil overSegmentation, SubPixelSegmenter, snapColorsToPalette, flattenTo, flagShadowSegments, splitAndMergeFlaggedSegmentsFromBlurryImage, clusterColors, enforceMinNumPixels, dan buildRegions. Ini memperkuat bahwa artefak transisi warna ditangani di tahap region.

`SubPixelSegmenter::execute` berulang kali memanggil mergeLoop dan rebuildSubPixelSegments, lalu pada jalur tertentu splitAndMergeBeaches. `SuperPixelSegmenter::execute` memuat urutan initialize → mergeLoop → swapLoop → mergeLoop. Belum dibuktikan bahwa SuperPixelSegmenter digunakan pada jalur UI/preset yang umum.

`BezierFitter::execute` memanggil initialize → segmentContours → fitBezierCurves → buildCurveReferenceArrays.

Bukti: `direct-calls.json` dan file `.asm.txt` terkait. Ekstraksi interval menggunakan alamat simbol T/t berikutnya: interval panjang dapat memuat helper tanpa nama. Daftar ini bukan call graph lengkap dan tidak menyelesaikan virtual/indirect calls.

## Model gambar: rekonstruksi warna dan least squares

Pada `GenerativeModel::computePixelColor`, instruksi sekitar `0x1000ee9b8–0x1000eea1e` mengakumulasi selisih produk koordinat dan mengalikannya dengan 0,5. Pola tersebut konsisten dengan luas bertanda polygon (shoelace). Selanjutnya empat komponen warna byte dikonversi ke double, dikalikan 1/255, dikalikan bobot luas, dan diakumulasikan (`0x1000eea33–0x1000eeab4`).

Interpretasi kuat untuk jalur region yang valid:

```text
predicted_pixel ≈ Σ(region_coverage × region_color / 255)
```

Bobot dihitung dari geometri per-pixel. Masih ada cabang penanganan luas negatif, penutupan region, dan fallback; rumus sederhana ini tidak merangkum semua cabang.

`GenerativeModel::findPotential` memuat pengurangan terhadap empat byte warna raster yang dinormalisasi 1/255, mengkuadratkan keempat selisih, menjumlahkannya untuk pixel yang diiterasi, lalu mengalikan hasil akhir dengan 0,5:

```text
E_image = 0.5 × Σ_pixel Σ_channel=0..3 (predicted - observed/255)²
```

Bukti aritmetika: `0x1000f0516–0x1000f05b9`; faktor 0,5 pada `0x1000f061c`. Konstanta dibaca langsung dari segmen Mach-O. Identitas urutan kanal, perlakuan alpha/premultiplication, dan transformasi sebelum buffer input ini belum dipastikan. Karena itu rumus ini merujuk pada **buffer internal fungsi**, bukan jaminan error langsung terhadap file asli.

Hubungan optimasi:

- `ContourSmoother::findPotential` memanggil `GenerativeModel::findPotential` di `0x1000c5420`.
- `ContourSmoother::findGradient` memanggil `GenerativeModel::findGradient` di `0x1000c5f85`.

Ini bukti lebih kuat daripada nama GenerativeModel saja: renderer geometrik memang berpartisipasi dalam evaluasi dan turunan kontur. Penggunaannya tetap bergantung pada cabang measurement/preset. Total objective kontur juga memiliki komponen lain yang belum seluruhnya direkonstruksi.

## Biaya palet

`PaletteFinder::computeCost` melakukan:

1. Memperbarui BoundaryMask.
2. Menjumlahkan `computePixelCost(x,y)` untuk dimensi yang diiterasi.
3. Menambahkan konstanta 1,0 dan mengambil log10.
4. Menambahkan suku berupa sebuah koefisien float dikali sebuah hitungan internal dikurangi 2.

Rekonstruksi aritmetika:

```text
S = Σ computePixelCost(x,y)
score = float(log10(double(S) + 1)) + c × (N_internal - 2)
```

Akumulasi S menggunakan float. Koefisien c berasal dari offset +0x4 objek PaletteFinder; N_internal berasal dari +0x8 objek yang ditunjuk field +0x70. Interpretasi sebagai penalti jumlah warna konsisten dengan parameter `cost_per_color` dan fungsi `findOptimalNumColors`, tetapi pemetaan layout field dan alasan offset “-2” belum dibuktikan. Jangan menyebut N_internal sebagai jumlah warna user-visible tanpa pemeriksaan tambahan.

Bukti: `PaletteFinder-computeCost.asm.txt`. Nilai konstanta +1 dikonfirmasi di `numeric-constants.json`.

`doKMeans` memanggil initializeK, assignK, lalu memilih computeWeightedMeanColors atau computeMeanColors berdasarkan cabang. Algoritma pemilihan palet lengkap masih lebih luas dari fungsi computeCost ini.

## Metrik penggabungan region

Bagian awal `PixelSegmenter::computeMergeMetric` mengambil hitungan n pada offset +0x8 dan empat float s pada +0xC…+0x18 dari dua objek region. Operasinya dapat ditulis:

```text
Δ_data = ||sA||²/nA + ||sB||²/nB - ||sA+sB||²/(nA+nB)
```

Bila s adalah jumlah komponen warna region, rumus tersebut sama dengan kenaikan within-region squared error akibat menggabungkan dua region:

```text
Δ_data = (nA*nB)/(nA+nB) × ||meanA-meanB||²
```

Interpretasi s sebagai jumlah warna didukung strings statistik Segment (`num_px`, `sum_px`), tetapi pemetaan penuh layout class belum dilakukan. Setelah komponen ini ada cabang penalti ukuran dengan powf. Jadi Δ_data bukan keseluruhan keputusan merge; ada fungsi pemanggil, parameter, dan syarat topologi yang belum diringkas.

Bukti: `PixelSegmenter-computeMergeMetric.asm.txt`, terutama `0x1001053ab–0x10010545f`.

## Metrik penggabungan Bézier

`BezierFitter::computeSelfCost` menyimpan hasil fitBezierCurve dalam cache fragmen; flag di offset +0x18 menandai kebutuhan hitung ulang, nilai cost di +0x10.

`BezierFitter::computeMergeMetric` mengambil dua fragmen bertetangga, menghitung/membaca cost masing-masing, melakukan fitting pada rentang gabungan, lalu mengembalikan:

```text
merge_metric = fit_cost(A∪B) - (fit_cost(A) + fit_cost(B))
```

Bukti: penjumlahan cost di `0x1000bc189–0x1000bc192`, fitting gabungan di `0x1000bc1b1`, pengurangan di `0x1000bc1b6`.

Ini menunjukkan penyederhanaan fragmen mengevaluasi perubahan kualitas fit. Ambang menerima merge, seluruh definisi fit_cost, dan kebijakan swap belum selesai dipetakan. Tidak cukup untuk menyatakan metode fitting tertentu seperti Schneider atau optimalitas global.

## Implikasi praktis

Hipotesis desain yang sekarang memiliki dukungan kuat adalah: region dibentuk dan diperbaiki, geometri batas diperhalus menggunakan objective gambar/geometri, kemudian kurva disederhanakan dengan membandingkan biaya fit. Untuk engine mandiri, ketiga masalah itu perlu dievaluasi terpisah; jumlah node akhir saja tidak mewakili kualitas segmentasi dan penempatan batas.

Temuan tidak membuktikan kualitas runtime, performa, identitas hasil Windows/macOS, ataupun kesiapan engine untuk dipanggil langsung. Tahap lanjutan yang paling bernilai ialah memetakan total objective ContourSmoother dan ambang merge/swap, lalu melakukan pengujian input-output melalui aplikasi bila diperlukan.

## Reproduksibilitas dan artefak

- Payload Windows sementara: `/private/tmp/vm-analysis-windows/unpacked`.
- Payload macOS dan dump lengkap: `/private/tmp/vm-analysis-mac`.
- Bukti terpilih yang persisten berada di direktori laporan ini.
- `direct-calls.json`: panggilan langsung dalam interval simbol terpilih; indirect calls tetap tercatat mentah.
- `numeric-constants.json`: konstanta bertipe yang dibaca dari file Mach-O, bukan hasil eksekusi.
- Script pemeriksaan disimpan di `scripts/`. Script memakai lokasi paket/temp sesi ini dan hanya sesuai untuk sampel yang diperiksa; bukan parser installer umum.

Pembaruan: [tahap 3](phase3-findings.md) memetakan struktur findPotential, measurement mode, dan aturan penerimaan/jadwal threshold Bézier. Bagian batas tahap 2 di atas adalah status saat laporan awal ditulis.
