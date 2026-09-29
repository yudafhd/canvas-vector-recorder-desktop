# Tahap 3 — Biaya kontur dan aturan merge/swap

Analisis statis lanjutan pada slice x86_64 macOS dari paket yang sama. Tidak ada executable yang dijalankan atau diubah. Bukti disassembly dan anotasi konstanta tersimpan di `phase3/`.

**Pembaruan:** [tahap 4](phase4-findings.md) memperinci biaya fitting per cabang, memulihkan sepuluh preset dan mapping UI, serta memperbaiki batas fungsi menggunakan LC_FUNCTION_STARTS. Daftar keterbatasan di bawah mencatat keadaan pada akhir tahap 3.

## 1. Keputusan merge/swap Bézier sudah terpetakan

Fungsi `BezierFitter::considerMergeAndSwap` (`0x1000bbfc0`) memprioritaskan merge, kemudian swap arah -1, kemudian swap arah +1. Pseudocode untuk nilai finite:

```text
if computeMergeMetric(fragment) < current_threshold:
    gabungkan fragment dengan next
    tandai cache cost perlu dihitung ulang
else if computeSwapMetric(fragment, -1) < 0:
    pindahkan batas satu sampel ke arah -1
    tandai kedua cache cost perlu dihitung ulang
else if computeSwapMetric(fragment, +1) < 0:
    pindahkan batas satu sampel ke arah +1
    tandai kedua cache cost perlu dihitung ulang
```

Bukti pembandingan: `0x1000bbfdf–0x1000bbfe3`, `0x1000bc011–0x1000bc015`, `0x1000bc056–0x1000bc05a`. Nilai sama dengan ambang tidak diterima. Instruksi ucomisd/jbe juga melewati penerimaan bila perbandingan unordered (NaN).

Merge metric dari tahap sebelumnya:

```text
Δmerge = fit_cost(A∪B) - fit_cost(A) - fit_cost(B)
```

Swap metric menghitung perubahan jumlah fit_cost dua fragmen setelah batas bergeser satu sampel. Arah -1 diperiksa lebih dahulu: mesin tidak menghitung kedua arah lalu selalu memilih minimum global. “Satu sampel” adalah indeks kontur internal, bukan satu pixel posisi x/y.

**Implikasi:** merge dapat menerima kenaikan error positif selama masih di bawah toleransi; swap harus menurunkan biaya. Ini menjelaskan bagaimana node bisa dikurangi tanpa mewajibkan error fitting turun pada setiap merge.

Loop luar memeriksa rantai fragmen sebelum memanggil fungsi ini, termasuk `next` dan `next->next`. Karena itu pseudocode bukan izin menggabungkan setiap pasangan tanpa syarat struktur. Validitas rentang dan penanganan kontur tertutup belum direkonstruksi seluruhnya.

## 2. Ambang merge berubah secara geometrik

`mergeAndSwapLoop` (`0x1000bbdc0`) memakai field:

| Offset relatif BezierFitter | Makna | Bukti |
|---|---|---|
| +0x00 | stat_thresh_initial, T0 | registrasi CoreEngine +0x2420 |
| +0x08 | stat_thresh_final, Tf | registrasi CoreEngine +0x2428 |
| +0x10 | fraksi pengaturan kenaikan, f | dibaca pembentuk jadwal; konstruktor mengisi 0,5 |
| +0x18 | max_iterations, N | registrasi CoreEngine +0x2438 |
| +0x70 | ambang aktif T | digunakan considerMergeAndSwap |

Konstruktor CoreEngine menempatkan BezierFitter pada +0x2420 (`0x1000d852f–0x1000d853c`), sehingga pemetaan nama parameter ke offset di atas memiliki bukti langsung.

Pseudocode jadwal, dengan N dan parameter dianggap valid:

```text
T = T0
q = double(expf(float(log(Tf/T0) / (N*f))))
for i = 0 .. N-1:
    scan fragmen dengan ambang T
    if i < N*f:
        T = T*q
    else:
        T = Tf
```

Update berlangsung setelah scan. Pembandingan dan pembulatan dapat membuat peralihan tidak persis sama dengan rumus clamp sederhana; kode tidak memakai `min(T*q, Tf)`.

Konstruktor menetapkan N=10, f=0,5, T0≈0,0001 dan Tf≈0,01. Dua threshold dibaca dari konstanta 16 byte pada `0x1002eba10`; nilai double aktualnya `9.999999747378752e-05` dan `0.009999999776482582`. Itu **nilai konstruktor**, bukan jaminan parameter aktif: preset, loadParameters, dan pengaturan UI dapat menggantinya.

Manfaat desain: penyederhanaan dimulai dengan toleransi kecil lalu meningkat. Jangan menyalin angka ini langsung ke engine lain karena skala fit_cost dan sampling belum tentu sama.

## 3. Tiga measurement mode kontur

`ContourSmoother::findPotential` membaca array measurement_types pada +0x08, diindeks phase. `VectorImage::getMovedVector` menghitung posisi double saat ini dikurangi posisi referensi float yang tersimpan. Sebut selisih itu d_i.

| Kode | Komponen measurement M |
|---|---|
| 0 | Σ_i ||d_i||² |
| 1 | GenerativeModel::findPotential(), yakni error rekonstruksi empat kanal yang dijelaskan tahap 2 |
| 2 | Σ_i max(||d_i|| - 0,7, 0)² |

Bukti dispatch: `0x1000c5361–0x1000c537b`; mode 0 sekitar `0x1000c5462–0x1000c548a`; mode 1 `0x1000c5420`; mode 2 `0x1000c53b2–0x1000c53f1`. Konstanta -0,7 berada pada `0x1002ebe30`.

Mode 2 tidak memberi penalti measurement dalam radius 0,7. Komponen biaya lain tetap berlaku di dalam radius tersebut. Satuannya mengikuti koordinat node internal; belum dibuktikan setara 0,7 pixel file input setelah seluruh preprocessing/downsampling.

**Koreksi penting untuk interpretasi sebelumnya:** penghalusan kontur tidak selalu menggunakan error raster. Rekonstruksi raster digunakan oleh mode 1; dua mode lainnya mengikat kontur pada posisi referensi.

## 4. Pilihan prior dan rumusnya

`executeCurrentPhase` memilih pointer fungsi berdasarkan prior_types:

- 0 → findQuadraticPriorPotential / Gradient.
- 1 → findSqrtPriorPotential / Gradient.
- 3 → findAngularPriorPotential / Gradient.
- Nilai lain masuk jalur error dalam fungsi ini.

Setelah setup, fungsi memanggil `Optimizer::doCG` (`0x1000c3155`) dan dapat memanggil punctureCorners bila flag phase aktif. Terdapat tiga slot phase; tidak semua phase harus aktif.

Untuk tiga titik berurutan a,b,c, definisikan u=b-a, v=c-b. Dua hitungan langkah integer h1,h2 dibaca dari +0x678 dan +0x67c.

Prior quadratic:

```text
Q(a,b,c) = ||v/h2 - u/h1||²
```

Prior angular, untuk panjang segmen nonzero:

```text
P_ang(a,b,c) = sqrt(2 - 2*dot(u/||u||, v/||v||) + 0.001)
             + w_length[phase] * (||v||/h2 - ||u||/h1)²
```

Bukti: `findAngularPriorPotential` pada `0x1000c3430–0x1000c3590`. Konstanta 2 dan 0,001 diambil dari Mach-O. Tidak terlihat pemanggilan acos; biaya sudut memakai fungsi dot-product dan akar. Formula tersebut tidak mengklaim penanganan segmen panjang nol yang aman di semua jalur.

Nama `length_penalty_weights` pada jalur ini berarti penalti **perbedaan panjang yang dinormalisasi langkah** antara dua segmen bersebelahan; bukan sekadar jumlah panjang kontur. Ini memperjelas deskripsi “penalti panjang” pada laporan sebelumnya.

## 5. Struktur biaya total findPotential

Pemetaan parameter dari registerParameters dan konstruktor CoreEngine (ContourSmoother pada +0x1d68):

| Offset relatif ContourSmoother | Parameter |
|---|---|
| +0x08 | measurement_types[3] |
| +0x14 | prior_types[3] |
| +0x20 | prior_strengths[3], α |
| +0x38 | length_penalty_weights[3] |
| +0x78 | air_pressure_weight, w_area |
| +0xA0 | anti_inv_pot_meas_scale, β |
| +0xA8 | anti_inv_pot_prior_scale, γ |

Struktur aljabar fungsi, untuk jalur finite dengan α nonzero:

```text
E = α * P_selected
  + γ * Σ_flagged_centers Q(a,b,c)
  + α * w_area * Σ_small_regions (A_current - n_reference)²
  + M_mode
  + β * Σ_nodes count_i * ||d_i||²
```

Definisi dan syarat penting:

- P_selected adalah penjumlahan prior yang dipilih. Region dengan field integer awal <=7 memakai Q langsung; untuk region lain terdapat flag edge yang dapat melewati prior, atau memanggil pointer prior terpilih.
- Region yang sama dengan field <=7 mendapat komponen area: `updateArea` dipanggil, field luas double +0x8 dikurangi field integer +0x0, lalu dikuadratkan. Interpretasi sebagai region kecil dengan referensi jumlah pixel kuat, tetapi makna seluruh layout region masih belum lengkap.
- Suku γ ditambahkan bila bit 0x10 pada byte node +0x1D aktif. Kode menghitung γ/α sebelum akumulasi prior kemudian mengalikan dengan α; rumus di atas adalah penyederhanaan matematis, bukan reproduksi pembulatan floating-point.
- Suku β memakai byte node +0x1E sebagai pengali count_i dan hanya diproses bila byte tersebut nonzero.
- Nama parameter menunjukkan maksud anti-inversion. Belum seluruh penetapan flag/count tersebut dipetakan, sehingga ini bukan bukti larangan topologis mutlak: yang terlihat adalah penalti tambahan.
- Formula merangkum `findPotential` yang diperiksa, bukan seluruh perilaku optimizer atau semua langkah perubahan topologi.

Bukti area: `0x1000c52de–0x1000c5350`; pengali prior: `0x1000c52b4–0x1000c52ba`; γ: `0x1000c4e7b–0x1000c4e89` dan `0x1000c5207`; β: `0x1000c54c0–0x1000c552b`.

## 6. Apa yang kini bisa digunakan

Untuk merancang engine mandiri, temuan ini memberi aturan eksperimen yang lebih konkret:

- Pisahkan pilihan measurement dari prior smoothness.
- Evaluasi penalti luas pada fitur kecil agar proses smoothing tidak mudah menghilangkannya.
- Perlakukan pengurangan jumlah fragmen dan perbaikan posisi batas fragmen sebagai keputusan berbeda.
- Gunakan jadwal toleransi merge yang dikalibrasi terhadap skala cost engine sendiri.

Ini inferensi desain dari binary, bukan implementasi yang sudah diuji menghasilkan kualitas setara.

## 7. Batas yang masih tersisa

- Definisi penuh fit_cost, sampling, dan seluruh jalur fitting linear/kubik belum dipulihkan.
- Pemetaan UI/preset ke parameter aktif belum selesai; nilai konstruktor bukan default global yang tervalidasi.
- Penetapan seluruh flag node/edge, definisi hitungan langkah, prior sqrt, serta penanganan degenerasi belum lengkap.
- Aturan Bézier di atas tidak otomatis berlaku untuk PixelSegmenter atau SuperPixelSegmenter. File PixelSegmenter disimpan sebagai bahan, tetapi tidak diklaim selesai dianalisis pada tahap ini.
- Belum ada eksekusi, benchmark, ataupun validasi output terhadap aplikasi. Temuan tahap 3 spesifik slice macOS x86_64; kesamaan nama pada Windows belum membuktikan kesamaan semua rumus.

## Bukti dan reproduksi

`phase3/*.asm.txt` berisi interval simbol yang diperiksa. `*.annotated.txt` menambahkan pembacaan data RIP-relative dari Mach-O. Anotasi menampilkan interpretasi float/double mentah; hanya konstanta dengan tipe pemakaian instruksi yang sudah diperiksa yang dipakai sebagai dasar laporan. Interval hingga simbol T/t berikutnya dapat menyertakan helper tanpa nama.

Script `scripts/annotate_phase3.py` mereproduksi anotasi dari payload/dump di lokasi temporary sesi. Script hanya untuk sampel ini. Semua perubahan pekerjaan ini berupa laporan dan artefak analisis di RND.
