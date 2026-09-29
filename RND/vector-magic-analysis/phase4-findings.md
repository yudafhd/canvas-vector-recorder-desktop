# Tahap 4 — Fitting Bézier, preset, dan pemetaan kontrol pengguna

Analisis statis slice **x86_64 macOS** dari installer yang diberikan. Temuan di bawah memperinci `fit_cost` pada [tahap 3](phase3-findings.md), sekaligus mengoreksi asumsi bahwa semua fungsi optimasi yang tersedia pasti digunakan jalur utama. Aplikasi belum dijalankan; kesetaraan output dengan implementasi ulang belum diuji.

**Lanjutan:** [tahap 5](phase5-findings.md) memulihkan pohon keputusan corner, fitur jendela tujuh titik, serta inisialisasi fragmen dan perubahan state node sebelum fitting.

## 1. Koreksi batas fungsi dan kekuatan bukti

Pemotongan disassembly lama berdasarkan simbol `nm` dapat memasukkan fungsi tanpa nama yang terletak sesudahnya. Tahap ini memakai **LC_FUNCTION_STARTS**: 3.757 titik awal fungsi ditemukan dan 30 fungsi relevan diekstrak dengan batas eksplisit. Berkas anotasi yang sedang diteliti sudah diperbarui.

Contoh penting: `findHessianAndGradient` sebenarnya berada pada `[0x1000bdb50, 0x1000bdfd0)`. Disassembly lama berlanjut sampai helper di belakangnya, sehingga tampak jauh lebih panjang. Helper tetap tersedia dalam disassembly sumber; instruksinya tidak boleh diatribusikan begitu saja kepada fungsi pembungkus.

Alamat di laporan adalah virtual address sebelum ASLR. Manifest, hash binary/slice, dan seluruh batas ada di [extraction-manifest.json](phase4/extraction-manifest.json) serta [function-boundaries.json](phase4/function-boundaries.json). Anotasi `candidate_f64x2` hanyalah pembacaan kandidat; tipe konstanta harus ditentukan dari instruksi yang memakainya.

## 2. Data fitting menggunakan parameter panjang chord

`computeDataAndTime`, `[0x1000ba430, 0x1000ba790)`, mengumpulkan titik kontur **di antara** kedua endpoint. Setelah normalisasi indeks kontur tertutup, jumlahnya `n = end - start - 1`; rentang tanpa titik interior mengembalikan 0.

Untuk endpoint `P0`, `Pend`, dan sampel interior `q[0..n-1]`:

```text
length[0] = |q[0] - P0|
length[i] = length[i-1] + |q[i] - q[i-1]|
total = length[n-1] + |Pend - q[n-1]|
t[i] = length[i] / (total == 0 ? 1 : total)
```

Bukti akumulasi jarak: `0x1000ba616–0x1000ba63a`; jarak dari endpoint pertama: `0x1000ba650–0x1000ba68e`; segmen terakhir dan normalisasi: `0x1000ba6f4–0x1000ba768`. Parameter `t` tidak diratakan menurut indeks dan tidak dioptimalkan ulang dalam helper fitting yang dibahas berikut. Flag boolean mengatur penandaan sampel, bukan iterasi reparameterisasi.

## 3. Fitting utama bercabang menurut jumlah sampel

`fitBezierCurve`, `[0x1000b95d0, 0x1000b9f10)`, mula-mula mengisi control point dari posisi kontur pada `start`, `start+1`, `end-1`, `end`. Setelah `computeDataAndTime`, dispatch pada `0x1000b97aa–0x1000b988c` adalah:

| Sampel interior n | Cabang yang terlihat |
|---|---|
| 0 | Return cost 0 tanpa menjalankan solver |
| 1 atau 2 | Bentuk kontrol kolinear; hitung biaya cabang pendek |
| 3 | Fit kuadratik dengan endpoint tetap, lalu konversi representasi ke kurva kubik |
| ≥4 | Fit kubik dengan endpoint tetap |

### Cabang kubik dan kuadratik

Helper kubik berada pada `[0x1000bc570, 0x1000bd0e0)`. Dengan endpoint tetap `P0, P3`:

```text
B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t)t^2 P2 + t^3 P3
a[i] = 3(1-t[i])^2 t[i]
b[i] = 3(1-t[i]) t[i]^2
r[i] = q[i] - (1-t[i])^3 P0 - t[i]^3 P3
```

Matriks `A` berukuran `2n × 4`, dengan unknown `u = [P1.x, P1.y, P2.x, P2.y]`. Dua baris per sampel adalah `[a,0,b,0]` dan `[0,a,0,b]`. Instruksi membentuk dan menyelesaikan:

```text
(Aᵀ A + 0.00001 I) u = Aᵀ r
```

Konstanta diagonal `0x3ee4f8b588e368f1` adalah double `1e-5`, ditulis mulai `0x1000bc935`. `dgemm` pada `0x1000bca56` mengakumulasi `AᵀA` dengan beta=1 sehingga diagonal itu tetap ada. `dgemm` kedua pada `0x1000bcb6d` membentuk RHS; `dgesv` pada `0x1000bcbe0` menyelesaikan sistem. Control point ditulis pada `0x1000bcc08–0x1000bcc51`.

**Biaya return berbeda dari objektif regularisasi solver:** loop `0x1000bcca0–0x1000bcd97` mengembalikan `Σ |B(t[i]) - q[i]|²`, tanpa menambahkan `1e-5 |u|²`, tanpa membagi jumlah sampel, dan tanpa faktor ½. Ini yang masuk ke `computeSelfCost`, `computeMergeMetric`, dan `computeSwapMetric` pada cabang ini.

Helper kuadratik `[0x1000bd0e0, 0x1000bdb50)` analog, dengan satu control point interior (dua unknown), basis `2(1-t)t`, dan regularisasi diagonal `1e-5`. Bukti: konstanta `0x1000bd3ef`, `dgemm` pada `0x1000bd515` dan `0x1000bd653`, `dgesv` pada `0x1000bd6c6`. Biaya return berasal dari residual kuadratik; pembungkus kemudian mengonversi kurva ke representasi kubik. Detail loop konversi belum divalidasi dengan eksekusi numerik binary.

Ekspor DLL Windows menyebut template `sla::BezierCurve<double, 2, 3>::fitDataFixedEnds(...)` dan versi derajat 2. Nama tersebut mendukung identifikasi fungsi, tetapi rumus di sini diturunkan dari instruksi macOS; kesamaan implementasi lintas platform belum dibuktikan.

### Cabang pendek perlu diperlakukan terpisah

Pada `n=1` atau `n=2`, konstanta SIMD lengkap membentuk:

```text
P1 = 0.75 P0 + 0.25 P3
P2 = 0.25 P0 + 0.75 P3
cost = |(1-t[0]) P0 + t[0] P3 - q[0]|²
```

Bukti kontrol: `0x1000b9c78–0x1000b9cc1`, dengan vektor konstanta lengkap di [short-fit-constant-vectors.json](phase4/short-fit-constant-vectors.json). Bukti biaya: `0x1000b9cc8–0x1000b9d81`. Cabang ini membaca sampel indeks 0 dan tidak terlihat melakukan loop atas sampel kedua sebelum return.

Jadi **jangan menyatakan semua cabang `fit_cost` identik dengan SSE seluruh sampel kubik**. Kurva kolinear ini juga memiliki parameterisasi berbeda dari interpolasi linear `L(t)`. Belum ditentukan seberapa sering cabang `n=2` tercapai pada kontur nyata, bagaimana fragmen pendek diperlakukan saat ekspor, atau dampak visualnya. Temuan ini belum cukup untuk menyebutnya bug aplikasi.

## 4. Fungsi potential/Hessian bukan bukti optimasi global aktif

Jalur langsung yang teridentifikasi:

```text
BezierFitter::execute
  → initialize
  → segmentContours → keputusan fragmen/merge/swap
  → fitBezierCurves → fitBezierCurve → helper fixed-end
  → buildCurveReferenceArrays
```

Audit men-decode byte instruksi `CALL rel32` dan `JMP rel32`, bukan hanya mencari nama simbol. Hasil di [bezier-direct-references.json](phase4/bezier-direct-references.json):

| Target | Pemanggil langsung yang ditemukan |
|---|---|
| `fitBezierCurve` | Fitting akhir, merge, swap, self-cost, dislike |
| `findPotential` | Dua call dari `findNumericalGradient`, pada `0x1000bb0f0` dan `0x1000bb171` |
| `findNumericalGradient` | Tidak ditemukan |
| `findHessianAndGradient` | Tidak ditemukan |

`findPotential` memiliki residual data dan penalti sambungan tangent. Penalti hanya melibatkan pasangan kurva yang lolos `isBezierWithFreeVariables` serta pemeriksaan flag mask `0x1`, dengan bobot field fitter `+0x50` (constructor mengisinya 10). Karena belum ada bukti fungsi ini berada di jalur fitting utama, penalti tersebut **tidak boleh ditambahkan begitu saja** ke rumus merge pada bagian 3.

Audit ini belum mencakup pemanggilan tak langsung, pointer data, atau pelacakan runtime. Tidak ditemukan pemanggil langsung bukan bukti bahwa fungsi mustahil dijalankan. Kesimpulan yang tepat: penggunaan optimasi Hessian/global dalam jalur utama belum terbukti.

## 5. Slider kompleksitas sudah menjadi rumus numerik

`VmVectorizationSettings::toString` mengaitkan field `+0x2c` dengan label `curve:`. Pembuatan UI memasang slider **1..12**, label `Bezier Curve Complexity`, dari `Fewer Nodes` menuju `More Nodes`; lihat [cuplikan UI](phase4/ui-curve-complexity-range.asm.txt).

Pada pengaturan advanced, `VmController::populateSettings`, `0x10011a451–0x10011a496`, membentuk:

```text
c = curve_complexity                  # 1..12
d = 12 - c
T0 = double(float32(0.0001 * (d+1)))
Tf = double(float32(0.1 * exp(0.4816652151407306 * d)))
```

Koefisien eksponen sesuai `ln(200)/11`. Pembulatan float32 terlihat pada `cvtpd2ps` lalu `cvtps2pd`; nilainya akhirnya disimpan sebagai double.

| Kompleksitas | T0, dibulatkan untuk dibaca | Tf, dibulatkan untuk dibaca |
|---|---:|---:|
| 1, Fewer Nodes | 0,0012 | 20 |
| 6 | 0,0007 | 1,7993153 |
| 12, More Nodes | 0,0001 | 0,1 |

Nilai lengkap 12 posisi ada di [curve-slider-thresholds.csv](phase4/curve-slider-thresholds.csv), dihitung dari konstanta binary dan rumus hasil inspeksi, bukan direkam dari aplikasi berjalan.

Implikasinya konsisten dengan label: kompleksitas tinggi menurunkan toleransi kenaikan error ketika menggabungkan fragmen. Ini menjelaskan kecenderungan mempertahankan lebih banyak node; belum merupakan jaminan jumlah node monoton untuk semua gambar. Ambang adalah selisih biaya internal, **bukan** galat maksimum dalam pixel.

## 6. Smoothness, anti-aliasing, dan corner detection

Field settings `+0x24` adalah smoothness; slider juga **1..12**, dibuktikan oleh [cuplikan UI](phase4/ui-smoothness-range.asm.txt). Dalam cabang advanced, untuk setiap fase `i`:

```text
z = (smoothness - 1) / 11
prior_strength[i] = float32(pmin[i] * exp(log(pmax[i]/pmin[i]) * z))
length_weight[i]  = float32(lmin[i] * exp(log(lmax[i]/lmin[i]) * z))
```

Nilai float32 dikonversi kembali menjadi double. Ini interpolasi geometrik, sehingga perpindahan slider tidak menambah bobot dengan selisih konstan. Bukti operasi log/exp dan pembulatan ada dalam `populateSettings` pada `0x10011a222–0x10011a40b`.

| Bobot fase 0,1,2 | Minimum | Maksimum |
|---|---|---|
| Prior, AA aktif | 0,05; 0,01; 0,45 | 10; 10; 10 |
| Prior, AA nonaktif | 0,05; 0,01; 0,45 | 20; 20; 20 |
| Length, AA aktif | 0,25; 0,05; 0,005 | 10; 1; 1 |
| Length, AA nonaktif | 0,5; 0,5; 0,5 | 40; 40; 40 |

Tabel diekstrak dari simbol data, tersedia di [ui-constant-tables.json](phase4/ui-constant-tables.json). Mapping ini menghubungkan UI ke bobot fungsi biaya kontur yang diteliti di tahap 3.

Field `+0x30` (`aa-cont`) mengatur ketiga measurement mode menjadi 1 jika aktif dan 0 jika nonaktif; prior type disetel 3 untuk ketiga fase (angular). Corner detection `+0x28` mengubah jadwal:

| Corner detection | `is_enabled[0..2]` | `do_puncture_corners[0..2]` |
|---|---|---|
| Aktif | 1,1,1 | 0,1,0 |
| Nonaktif | 1,0,1 | 0,0,0 |

Bukti penulisan flag: `0x10011a413–0x10011a44f`; konstanta 4-int adalah `[0,0,0,1]`. Jadi kontrol corner bukan sekadar mengubah satu threshold: ia mengaktifkan fase tengah beserta operasi puncture. Detail kriteria lokal puncture belum diuraikan penuh.

## 7. Preset aktual mengganti nilai constructor

Sepuluh blok preset, masing-masing berisi 100 parameter, berhasil dibaca melalui pointer `EP_*`. Data lengkap ada di [embedded-presets.json](phase4/embedded-presets.json), ringkasan di [preset-summary.csv](phase4/preset-summary.csv).

| Preset | Measurement | Fase aktif | T0 | Tf | Iterasi maksimum |
|---|---|---|---:|---:|---:|
| CLASSIFY | 0,0,0 | 0,1,2 | 1e-8 | 0,2 | 20 |
| LOGO AA, HIG/MED/LOW | 1,1,1 | 0,1,2 | 1e-8 | 0,2 | 20 |
| LOGO, HIG | 0,0,0 | 0,1,2 | 1e-8 | 0,5 | 20 |
| LOGO, MED | 0,0,0 | 0,1,2 | 1e-8 | 0,6 | 20 |
| LOGO, LOW | 0,0,0 | 0,1,2 | 1e-8 | 0,7 | 20 |
| PHOTO, HIG | 0,0,0 | 0 saja | 0,0001 | 0,5 | 10 |
| PHOTO, MED | 0,0,0 | 0 saja | 0,0001 | 3 | 10 |
| PHOTO, LOW | 0,0,0 | 0 saja | 0,0001 | 10 | 10 |

Baris CLASSIFY melaporkan isi blok parameter; bukan klaim bahwa tahap klasifikasi menjalankan fitting. Tabel juga tidak berarti preset yang sama pada kolom ini identik pada semua 100 parameter.

Basic memilih `_ep_files[base + quality]`: base 0 untuk PHOTO, 3 untuk LOGO_AA, dan 6 untuk LOGO. Urutan tepat tersedia di [basic-preset-order.json](phase4/basic-preset-order.json). Advanced memuat `EP_LOGO_MED_AA` sebagai dasar sebelum override; untuk cabang contour/curve yang diperiksa, `max_iterations` tetap 20. Task klasifikasi ditangani lebih awal dengan `EP_CLASSIFY`.

**Measurement mode 2** memang ada dalam mesin, tetapi tidak digunakan oleh sepuluh preset ini ataupun mapping toggle AA advanced yang diperiksa. Jangan menganggap mode 2 sebagai perilaku normal UI tanpa bukti tambahan.

## 8. Manfaat untuk pengembangan engine sendiri

Temuan sekarang cukup konkret untuk membuat eksperimen terpisah: parameterisasi panjang chord, fixed-end fitting dengan regularisasi, biaya residual per fragmen, dan merge berdasarkan toleransi yang meningkat. Pengaturan smoothness dapat dipetakan secara geometrik, sementara kompleksitas mengontrol toleransi penyederhanaan.

Ada tiga batas yang harus dipertahankan ketika menerapkannya: biaya cabang pendek berbeda; biaya regularisasi solver tidak ikut biaya merge; dan penalti tangent/Hessian belum terbukti aktif di jalur utama. Skala koordinat, kepadatan sampel, serta aturan corner dapat mengubah hasil meskipun angka ambang disalin persis. Tidak ada perubahan engine atau UI proyek pada tahap penelitian ini.

Langkah lanjutan yang paling bernilai adalah menelusuri pemilihan fragmen awal dan puncture corner, lalu menguji kasus sintetis dengan n=0/1/2/3/4 pada aplikasi berjalan. Pengujian dinamis diperlukan untuk menilai ketercapaian cabang pendek, kesetaraan hasil, dan perbedaan Windows/macOS. Tidak diperlukan untuk mempertahankan kesimpulan statis yang dibuktikan di atas.

## Reproduksi

Dengan hasil ekstraksi macOS, disassembly x86_64, dan `nm -C` dari tahap sebelumnya masih tersedia:

```sh
python3 RND/vector-magic-analysis/scripts/extract_phase4.py
```

Script menerima `--binary`, `--disassembly`, `--symbols`, dan `--output` untuk lokasi lain. Ia membaca byte/data, memotong disassembly, men-decode referensi langsung, dan menulis artefak; tidak memuat atau menjalankan binary target. Hasil ekstraksi dan konsistensi tabel diperiksa terpisah dari klaim perilaku runtime.
