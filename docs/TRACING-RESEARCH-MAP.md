# Pemetaan riset ke engine tracing

Peta ini menghubungkan bukti yang sudah tersedia ke implementasi produksi di `src/tracing/engine.ts`, `worker.ts`, dan `page.ts`. Label **terverifikasi** berarti mekanisme matematis/keputusan lokal diturunkan dari bukti statis yang disebutkan. Label itu tidak menyatakan bahwa seluruh pipeline atau output sudah cocok dengan Vector Magic.

**Kernel terverifikasi**: rumus atau aturan lokal diterapkan sesuai temuan. **Adaptasi**: kernel itu dipakai dengan state, sampling, kontrol, atau guard milik aplikasi ini. **Pendekatan**: mekanisme mandiri untuk bagian yang belum direkonstruksi. **Belum diterapkan**: bukti belum cukup untuk menerapkan seluruh syarat/state dengan aman.

## Peta setiap tahap

| Tahap engine | Temuan dan bukti | Implementasi saat ini | Status dan batas |
| --- | --- | --- | --- |
| Decode, resolusi, alpha | `ensureFlattened`, `Preprocessor::setPixels`; [alur controller](../RND/vector-magic-analysis/deep-analysis.md) | `page.ts` menggunakan decode browser/downscale; `quantize` membagi alpha pada 128; worker menjalankan engine | **Pendekatan**. Flattening, ruang warna, dan alpha buffer VM belum dipulihkan penuh. Batas 1024 dan threshold alpha milik aplikasi ini. |
| Klasifikasi/preset | `ParameterClassifier`, blok `EP_*`; [tahap 4 §7](../RND/vector-magic-analysis/phase4-findings.md) | Kontrol manual jumlah warna/detail/pembersihan; tidak ada klasifikasi otomatis VM | **Belum diterapkan**. Tidak menganggap preset LOGO_AA aktif hanya karena input antialias. |
| Palet | `doHistogram`, `doKMeans`, weighted means; sebagian `computeCost`; [analisis lanjutan](../RND/vector-magic-analysis/deep-analysis.md) | `quantize`: histogram RGB 5-bit, seed berbobot, 12 iterasi; `refinePaletteInteriors`: koreksi pusat dari sumber konsisten | **Pendekatan**, dengan struktur umum yang didukung riset. Seeds, bobot, jumlah iterasi, dan pemilihan jumlah warna tidak diklaim sebagai algoritma VM. Tag `APPROX-PALETTE`. |
| Region dan artefak | Pixel/SubPixelSegmenter, `snapColorsToPalette`, `enforceMinNumPixels`; komponen Δdata merge region diketahui, penalti ukuran/threshold belum lengkap | `compactPalette`, `refineTransitions`, `cleanRegions`, `cleanTransitionRegions` | **Pendekatan**. Threshold RGB 18/96, luas bintik, RGB mixture dan skor tetangga adalah heuristik aplikasi. Tag `APPROX-SEGMENTATION`. Tidak memakai Δmerge Bézier untuk menggabungkan region warna. |
| Identitas/konektivitas region | `buildRegions`; kebijakan lengkap belum dipulihkan | `identifyRegions`, komponen 4-connected termasuk transparansi | **Adaptasi**. Konektivitas ini milik aplikasi; tidak menyatakan piksel diagonal selalu terpisah pada output VM. Tag `ADAPTER-REGIONS`. |
| Node kisi dan batas | Label bertetangga berbeda membentuk node; koordinat awal integer double; [tahap 5 §2](../RND/vector-magic-analysis/phase5-findings.md) | Enumerasi sisi horizontal/vertikal, adjacency graph | **Kernel terverifikasi** untuk perbedaan label dan koordinat kisi. Penyimpanan graph serta pembagian rantai bersama adalah adaptasi. Tag `R5-GRID`. |
| Arah batas di junction | Barat, selatan, timur, utara; kandidat first-side sesuai region; konteks first-cell memilih kandidat; fallback terakhir; [tahap 7 §1–3](../RND/vector-magic-analysis/phase7-findings.md) | `chooseBoundaryCandidate`, dipakai saat membangun setiap loop | **Kernel terverifikasi + adaptasi state**. Konteks memakai sel di kanan sisi masuk; kunjungan sisi berarah dan penutupan loop adalah mekanisme aplikasi. Tidak mengklaim reproduksi owner-region node/cabang nol kandidat VM. Tags `R7-TRACE`, `ADAPTER-TRACE`. |
| Cleanup sampel | Enam pola x/y, first match, mask keeper; tabel identik Mac/Windows; jalur non-AA; [tahap 6](../RND/vector-magic-analysis/phase6-findings.md) | Tidak menjalankan mask tersebut pada graph aplikasi | **Belum diterapkan**. Tipe 3 diketahui sebagian, tetapi seluruh flag proteksi `0x40/0x80`, state kontur, dan pemilihan jalur AA belum direkonstruksi. Menghapus sampel sekarang akan mengubah biaya/fit tanpa state pembanding. RDP yang dipakai untuk guard sudut bukan cleanup VM. |
| Measurement kontur | Warna = jumlah luas cakupan × warna / 255; E = ½Σ residual empat kanal²; [tahap 10](../RND/vector-magic-analysis/phase10-findings.md) | `coverageObjective`: clipping luas swept edge dan residual raster; `measureEdge` menjadi warm start | **Kernel warna/energi terverifikasi + adaptasi geometri**. Clipping dan gradient boundary integral diturunkan mandiri, diuji finite differences. Premultiplied RGBA host bukan preprocessing VM. Dilewati saat hapus putih aktif karena target raster berubah. Tags `R10-RASTER`, `ADAPTER-RASTER`. |
| Prior/optimizer | Q=‖v/h2−u/h1‖²; angular √(2−2cosθ+0,001)+w(‖v‖/h2−‖u‖/h1)²; tiga fase doCG; [tahap 3](../RND/vector-magic-analysis/phase3-findings.md) | Warm start lama diikuti `refineCoverage`, `angularPrior`; penalti luas loop kecil ≤7 piksel | **Kernel angular terverifikasi, optimizer/area adaptasi**. Bobot angular 0,3, length 0,25, area 5, maksimal 12 langkah projected descent per chain adalah pilihan aplikasi. Area referensi memakai loop kisi; flag/count region VM dan anti-inversion lengkap belum dipulihkan. Guard arah sisi lokal bukan bukti bebas self-intersection. Tags `R3-ANGULAR`, `ADAPTER-OPTIMIZER`, `ADAPTER-AREA`. |
| Corner/puncture | Tujuh titik → 21 fitur; classifier memakai f0/f2/f6/f8/f15/f16; [tahap 5 §3–4](../RND/vector-magic-analysis/phase5-findings.md) | `cornerFeatures`, `probablyPunctured`, sesudah smoothing; diterima menjadi batas rentang fitting | **Kernel terverifikasi untuk input finite + adaptasi**. Diperiksa terhadap interpreter disassembly. Guard sudut raster sebelum smoothing tetap mandiri; placement sesudah satu pass menggantikan fase 1 dari tiga fase VM. NaN ditolak dengan kebijakan aplikasi. Tags `R5-CORNER`, `ADAPTER-CORNERS`. |
| Parameter chord | Akumulasi jarak termasuk kedua endpoint, normalisasi total, tetap selama solve; [tahap 4 §2](../RND/vector-magic-analysis/phase4-findings.md) | `fitFixedEnds` menghitung `times` sekali | **Kernel terverifikasi**. Tidak melakukan Newton reparameterization dalam kernel biaya. Tag `R4-FIT`. |
| Fixed-end fitting/biaya | n=0 cost 0; n=1/2 kontrol ¼/¾ dengan cost linear sampel pertama; n=3 kuadratik→kubik; n≥4 kubik; diagonal 1e-5; SSE tanpa ridge; [tahap 4 §3](../RND/vector-magic-analysis/phase4-findings.md) | `fitFixedEnds`; normal system 4×4 diselesaikan sebagai dua blok 2×2; cabang pendek dipertahankan | **Kernel terverifikasi** secara aljabar, bukan identitas floating-point BLAS/dgesv. Dipakai untuk self/merge/swap cost dan kandidat output. `maxError` terpisah adalah guard aplikasi; tidak mengubah definisi cost. Tag `R4-FIT`. |
| Fragmen awal/cache | Satu langkah per fragmen, record terminal, cached cost; [tahap 5 §6](../RND/vector-magic-analysis/phase5-findings.md) | `selectFragments`: unit fragments, terminal, cache yang diganti setelah merge/swap | **Kernel terverifikasi + adaptasi**. Rantai dibagi pada guard/corner/junction dan seam/farthest point aplikasi; node state 0…5, ID kurva, cleanup sampling VM belum direproduksi. Tag `R5-FRAGMENTS`. |
| Merge dan swap | Δmerge=cost(A∪B)−cost(A)−cost(B), terima `<T`; swap −1 lalu +1 bila `<0`; [tahap 3 §1](../RND/vector-magic-analysis/phase3-findings.md) | `chooseFragmentOperation`, `selectFragments`; shift satu indeks sampel dan invalidasi dua cache | **Kernel terverifikasi + guard adaptasi**. Maksimum galat sampel ≤toleransi ditambahkan untuk menjaga geometri, khususnya cabang pendek. Nilai NaN/Infinity ditolak; pemeriksaan kelengkapan state dan topology VM masih belum lengkap. Tags `R3-MERGE`, `ADAPTER-FRAGMENTS`. |
| Jadwal ambang/kontrol | Geometric growth setelah scan; float expf; advanced complexity 1…12 → T0/Tf; [tahap 3 §2](../RND/vector-magic-analysis/phase3-findings.md), [tahap 4 §5](../RND/vector-magic-analysis/phase4-findings.md) | `mergeThresholdSchedule`, `complexityThresholds`; 20 scan, f=0,5 | **Kernel rumus terverifikasi, pemetaan UI adaptasi**. Detail aplikasi memetakan ke `round(6−4 log2(tolerance/0,8))`, clamp 1…12. Default seimbang c=6. Ini bukan preset/settings VM gambar daun yang diketahui. JS Math.exp + fround bukan klaim bit-identik expf platform. |
| Kurva untuk ekspor | Fixed-end fit dijalankan jalur utama; tangent/Hessian global tidak terbukti aktif; [tahap 4 §4](../RND/vector-magic-analysis/phase4-findings.md) | Kandidat fixed-end dipakai jika arah tangen sesuai; lainnya `fitWithSharedTangents` menjaga sambungan dan galat | **Adaptasi eksplisit**. Refit bertangen bersama, split dan Newton di adapter tidak dipresentasikan sebagai solver VM. Tidak menambahkan penalti tangent/Hessian ke biaya merge. Tag `ADAPTER-TANGENTS`. |
| Lapisan SVG/transparansi | Exporter/compound curves hadir; kebijakan layering lengkap belum diteliti | Area-sort, underpaint bidang warna, hole transparan evenodd, shared chain dibalik | **Adaptasi** untuk mengurangi celah render. Bukan reproduksi `Exporter::generateCompoundCurves`. Tag `ADAPTER-SVG`. |

## Yang berubah pada putaran ini

Biaya fitting tidak lagi sekadar galat dari fitter bertangen mandiri. Engine sekarang memakai kernel fixed-end untuk biaya tiap fragmen, memulai unit fragments dan menjalankan merge/swap dengan jadwal serta prioritas hasil riset. Classifier corner tujuh titik dan pilihan lokal batas juga dipakai oleh pipeline produksi. Refit tangen tetap sebuah adapter yang dapat dihitung lewat diagnostics.

`TraceResult.diagnostics` mencatat unit fragments awal, jumlah merge, jumlah swap, corner tambahan dari classifier, dan fragment yang memakai refit tangen. Nilai nol pada mode tanpa smoothing memang diharapkan karena fitting kurva dilewati. Data ini untuk validasi; tidak dimasukkan ke alur pengguna.

## Verifikasi dan batas bukti

`tests/tracing.test.mjs` menguji semua cabang n, kontrol/ridge dan biaya terhadap solver dense pivoted yang independen, 1.036 vektor classifier terhadap interpreter disassembly (termasuk nilai threshold tepat dan double sebelahnya), 32 jendela fitur, prioritas merge/swap, jadwal tanpa clamp, keputusan tracing lokal, dan regresi bentuk/topologi. Golden vectors dapat dibuat ulang dengan:

```sh
python3 RND/vector-magic-analysis/scripts/generate_tracing_references.py
```

Generator tidak menjalankan binary target. Validasi rumus berbeda dari validasi runtime/output. [Protokol runtime tahap 9](../RND/vector-magic-analysis/phase9-runtime-decision-protocol.md) mencatat bahwa debugger attach ditolak, sehingga metric/threshold aktif per keputusan belum tersedia.

Uji integrasi memakai gambar yang diminta: `RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png`. SVG sebelum/sesudah, input BMP yang sama, hash, opsi, diagnostics, perbandingan raster dan batas pengukuran tersedia di [laporan uji daun](../RND/tracing-quality/leaves-research-v4/REPORT.md). Tidak ada hasil ekspor VM gambar daun yang dipakai sebagai ground truth.

## Lanjutan: model raster dan prior angular

Lihat [laporan tahap 10](../RND/vector-magic-analysis/phase10-findings.md) dan [uji daun v5](../RND/tracing-quality/leaves-raster-v5/REPORT.md). `rasterSteps` menghitung langkah yang diterima, `smallAreaConstraints` loop kecil yang dibatasi. `rasterEnergyBefore/After` menjumlahkan objective patch per rantai dalam urutan pemrosesan; patch dapat bertumpang tindih. Angka ini bukan galat global SVG akhir. Model memprediksi polyline sebelum fitting Bézier, sehingga hasil ekspor tetap harus diukur terpisah.

## Optimasi tanpa perubahan mekanisme

`trianglePixelClipper` memakai buffer lokal yang digunakan ulang dengan urutan clipping/aritmetika sama. `coverageObjective.differentiate` menggunakan prediksi kandidat yang sudah diterima. Tidak mengubah bobot, prior atau kebijakan keputusan. Differential test dan benchmark lengkap ada di [laporan performa v6](../RND/tracing-quality/leaves-performance-v6/REPORT.md); hasil daun identik byte demi byte dengan v5.

## Guard geometri sesudah fitting (v7)

Tag `ADAPTER-FIT-GUARD`: `curveDeviation` mengukur deviasi sampel kurva terhadap polyline, termasuk di antara sampel fitting. Fragmen dengan deviasi melebihi min(tolerance, 0,35) dicoba ulang dengan tolerance lebih ketat dan batas penambahan segmen. Ini adaptasi ekspor; biaya dan keputusan merge/swap hasil riset tidak berubah. Deviasi bersifat satu arah dan tersampling, bukan batas Hausdorff kontinu. `guardedFits` menghitung refit diterima; `fitDeviationBefore/After` adalah maksimum deviasi fragmen sebelum/sesudah guard. Pengujian raster SVG akhir tetap offline, bukan kriteria acceptance runtime. Hasil: [daun](../RND/tracing-quality/leaves-bezier-v7/REPORT.md), [apel](../RND/tracing-quality/apple-bezier-v7/REPORT.md).

## Pembersihan komponen transisi (v8)

`ADAPTER-REGION-MIXTURE`: identitas komponen, dukungan tetangga besar dan residual campuran warna sumber membatasi kandidat pembersihan. Seluruh threshold dan kebijakan acceptance adalah adaptasi, bukan rekonstruksi lengkap biaya merge region VM. `mergedTransitionRegions` menghitung kandidat direklasifikasi (tidak selalu sama dengan penurunan jumlah kontur); `reassignedTransitionPixels` menghitung piksel diubah. Pass tidak berjalan ketika pembersihan mati. Perlindungan detail hanya berlaku untuk aturan pass ini; cleanup lama tetap terpisah. Bukti dan pengujian: [shipping doodle](../RND/tracing-quality/shipping-regions-v8/REPORT.md).

## Pemulihan pusat warna dari interior (v9)

`ADAPTER-PALETTE-INTERIOR`: pusat palet yang sudah ada dikoreksi dari lingkungan opaque dengan warna konsisten. Perlu ≥8/9 tetangga dalam radius RGB 18, ≥8 sampel per pusat, dan perpindahan pusat >18. Dilakukan sesudah compact palette saat cleanup aktif, sebelum koreksi transisi. Semua angka dan pemilihan tahap adalah adaptasi; bukan klaim objective VM. Tidak menambah slot atau memulihkan warna yang tidak terwakili label mana pun. [Hasil shipping dan regresi](../RND/tracing-quality/shipping-palette-v9/REPORT.md) mencatat peningkatan warna interior dan kenaikan kecil galat tepi.

## Ruas lurus panjang (v10)

`ADAPTER-STRAIGHT-SPANS`: deteksi ruas ≥48 piksel dengan chord error ≤min(0,35; tolerance/2), tanpa pembalikan arah atau corner internal. Emit `L` sebelum fitting fragmen, gunakan arah garis pada tangen sambungan tetangga. Mengubah pembagian rentang dan melewati merge/swap untuk ruas yang sudah berupa garis; ini adaptasi, bukan kernel keputusan VM. `straightSpans` mencatat jumlah ruas output. [Uji barong](../RND/tracing-quality/barong-lines-v10/REPORT.md) membuktikan kelurusan lokal; galat raster sedikit meningkat.

## Kelonggaran noise garis pada geometri UI (v11)

`ADAPTER-UI-LINE-NOISE` memperluas kandidat `straightSpans` hingga deviasi chord 0,65 px hanya untuk residual osilasi (RMS ≤0,32; ≥3 pergantian tanda signifikan >0,05 px) bila melewati batas ketat lama. Monotonicity, panjang 48 px dan corner guard tetap berlaku. [Laporan SVG UI nyata](../RND/tracing-quality/barong-ui-v11/REPORT.md) memisahkan bukti tes pada hasil ekspor dari validasi ulang pipeline UI yang masih diperlukan. Ini menggantikan batas kandidat v10, bukan perubahan biaya kernel fitting VM.

## Validasi lanjutan keluaran UI v11

SVG UI baru yang diberikan pengguna mengonfirmasi dua ruas celah lidah pada y=530…590 viewBox kini lurus (RMS residual <1e-12 px); sebelumnya 0,263/0,290 px. Path tetap 57, segmen 1841→1833. [Bukti dari dua SVG UI](../RND/tracing-quality/barong-ui-v11-validation/REPORT.md). Ini memvalidasi geometri lokal, bukan parity piksel Canvas dengan sips atau fidelity seluruh gambar.

## Penyederhanaan ekspor konservatif (v12)

`ADAPTER-EXPORT-COMPACTION`: `compactSmoothCurves` mencoba satu pass pasangan cubic pada shared chain setelah fitting. Garis dan corner terlindungi tetap. Endpoint/tangen luar dipertahankan; guard jarak tersampling dua arah 0,08 px. Ini adaptasi terpisah dari biaya merge/swap VM. `compactedCurvePairs` mencatat pasangan digabung; diagnostik fitDeviation sebelumnya mengukur tahap sebelum kompaksi. [Audit barong menyeluruh](../RND/tracing-quality/barong-curves-v12/REPORT.md) memisahkan tes geometri ekspor UI dari pipeline raster offline dan menyebut kenaikan kecil galat raster.

## Cekungan dangkal pada kontur hampir cembung (v13)

`ADAPTER-SHALLOW-DENTS`: proyeksi terbatas ke chord hull pada loop tertutup hampir cembung sesudah smoothing. Syarat luas ≥64, gap hull ≤1%, chord ≥8, perpindahan ≤0,65, monotone, tanpa melewati corner terlindungi. Adaptasi mandiri; bukan mekanisme VM atau classifier gigi. Energi raster diagnostik sebelum tahap ini tidak mewakili hasil sesudahnya. [Uji gigi dan kompromi fidelity](../RND/tracing-quality/barong-teeth-v13/REPORT.md).

## Perlindungan detail kecil (v14)

`ADAPTER-SMALL-DETAIL`: `cleanRegions` memakai sampel raster untuk menolak penggantian region kecil yang masih didukung warna sumber. Minimum 3 piksel, dukungan ≥max(2, ceil(luas/4)), galat RGB kuadrat asli ≤1024 dan kenaikan galat penggantian >1024. Ini heuristik mandiri, bukan biaya merge VM yang dipulihkan. Dapat mempertahankan bintik asli; tidak memulihkan detail yang hilang saat resize. [Reproduksi doodle dan batas validasi UI](../RND/tracing-quality/doodle-details-v14/REPORT.md).
