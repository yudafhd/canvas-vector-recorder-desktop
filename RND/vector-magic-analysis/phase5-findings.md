# Tahap 5 — Pembentukan kontur, fragmen awal, dan keputusan corner

Tahap ini menghubungkan kontur hasil segmentasi ke fitter yang dibahas di [tahap 4](phase4-findings.md). Hasil utama: pemetaan state node, inisialisasi fragmen per langkah kontur, serta rekonstruksi pohon keputusan corner yang benar-benar dipanggil jalur smoothing. Analisis tetap statis pada slice macOS x86_64. Aplikasi target belum dijalankan dan keseluruhan mesin raster-ke-vektor belum selesai direkonstruksi.

## 1. Alur yang terkonfirmasi

```text
Segmenter::execute(...) → label region dan buildRegions
VmController::contourSmoothImage(...), jika perlu dihitung ulang:
  BoundaryTracer::execute()
    enumerateBoundaryNodes → posisi node → traceBoundary
    → tandai junction → removeRedundantNodes
  ContourSmoother::execute(true)
    initialize
    untuk fase 0,1,2 yang aktif:
      Optimizer::doCG()
      jika do_puncture_corners[fase]: punctureCorners()
Kemudian pada tahap fitting:
  BezierFitter::initialize()
  segmentContours → followContour → selectKeepers
    → mergeAndSwapLoop → initializeFragments → keputusan merge/swap
  fitBezierCurves → fitBezierCurve
```

Bukti penghubung controller: `0x10011b740` memanggil BoundaryTracer, disusul `0x10011b756` memanggil ContourSmoother. `executeCurrentPhase` memanggil `doCG` pada `0x1000c3155`, **kemudian** `punctureCorners` pada `0x1000c3170` apabila flag fase aktif. Untuk preset umum dan advanced dengan corner aktif pada tahap 4, puncture terjadi sesudah optimasi fase 1 (indeks mulai 0), sebelum fase 2.

Ini juga memperjelas perbedaan dengan temuan Hessian tahap 4: penggunaan optimizer dalam **ContourSmoother** memiliki bukti call langsung. Penggunaan fungsi Hessian **BezierFitter** tetap belum terbukti.

## 2. Batas area dibentuk dari label, lalu dibersihkan

`BoundaryTracer::enumerateBoundaryNodes` membandingkan label piksel bertetangga dan menandai endpoint batas bila label berbeda; contoh `0x1000bff58–0x1000bffbd` dan `0x1000bffd2–0x1000c0025`. Border diproses tersendiri dalam bagian selanjutnya. Posisi awal node adalah koordinat integer yang disimpan sebagai double, disertai salinan float sebagai referensi.

`traceBoundary` memeriksa empat arah kandidat. Syarat yang terlihat pada `0x1000c0544–0x1000c057e` mencakup node kandidat valid, label sisi pertama sama dengan region yang ditelusuri, label sisi lain berbeda, dan kandidat belum tercatat dikunjungi untuk region itu. Fungsi memiliki cabang khusus bila lebih dari satu kandidat ditemukan. Aturan lengkap pemilihan pada junction/diagonal dan seluruh penanganan hole belum ditranskripsikan ke pseudocode lengkap pada tahap ini.

Ada tiga sumber penanda node tipe 3 yang sekarang jelas:

| Sumber | Aturan yang terkonfirmasi | Bukti |
|---|---|---|
| Sudut bingkai gambar | `(x==0 atau x==W) dan (y==0 atau y==H)` | `setInitialNodePositionAndType`, `0x1000d429b–0x1000d42ce` |
| Junction label | Jumlah pasangan label sama di antara empat label sekitar node ≤1 | `BoundaryTracer::execute`, `0x1000bfce0–0x1000bfd31` |
| Corner geometrik setelah smoothing | Pohon keputusan pada bagian 4 menerima kandidat | `0x1000c41e9–0x1000c4224` |

Aturan junction setara dengan sedikitnya tiga label berbeda dalam empat slot, termasuk sentinel `-1` untuk posisi di luar gambar. Ini membuktikan bahwa tipe 3 tidak berarti hanya corner yang terdeteksi dari sudut geometrik.

Sebelum smoothing, `removeRedundantNodes` memang memodifikasi sampling: penandaan penghapusan menggunakan bit `0x40` pada **byte node +0x1d**, lalu index node dipetakan ulang. Ada pemeriksaan pelindung tipe 3 pada `0x1000c0d79` dan `0x1000c1158–0x1000c1166`, serta pemanggilan `patternMatch` pada `0x1000c124d`. Seluruh aturan pattern tersebut masih menjadi pekerjaan lanjutan. Kepadatan sampel yang dipakai tahap 4 karena itu tidak boleh diasumsikan selalu satu titik per piksel.

## 3. Puncture menggunakan tujuh titik dan lima perubahan arah

`ContourSmoother::punctureCorners`, mulai `0x1000c3790`, melewati region dengan jumlah node `<7` (`0x1000c38a4`). Untuk region lainnya, jendela kontur tertutup berisi:

```text
p[-3], p[-2], p[-1], p[0], p[1], p[2], p[3]
```

Enam vektor langkah dinormalisasi dengan panjang Euclidean. Untuk langkah panjang nol, hasil pemilihan SIMD mempertahankan vektor nol. Lima ukuran perubahan arah dibentuk:

```text
a[j] = 2 - 2 * dot(unit_step[j], unit_step[j+1]), j=0..4
c = a[2]  # perubahan arah pada titik tengah p[0]
```

Untuk vektor satuan nondegenerat, ini sama dengan kuadrat selisih arah. Nilai lurus 0, belokan 90° bernilai 2. Nilainya tidak memakai tanda putaran sehingga konteks cekung/cembung tidak dibedakan oleh ukuran ini saja. Bukti normalisasi: `0x1000c39d0–0x1000c3a74`; lima ukuran: `0x1000c3a7a–0x1000c3b72`; pembaruan jendela: `0x1000c3ba0–0x1000c3d26`.

Fungsi membangun 21 fitur pada stack. Nama berikut adalah nama analisis, bukan nama variabel asli. Pembacaan lane SIMD dan alamat stack menghasilkan:

```text
Jika a[1] > a[3], balik urutan a untuk fitur sisi:
  [outer_low, inner_low, c, inner_high, outer_high] = reverse(a)
Selain itu gunakan urutan a apa adanya (termasuk saat sama).
neighbors = [a[0], a[1], a[3], a[4]]
side_three = [outer_low, inner_low, outer_high]
```

| Indeks fitur | Rekonstruksi |
|---|---|
| f0 | Jumlah empat `neighbors`, tidak termasuk pusat |
| f1 | `a[1]+a[3]` |
| f2 | Jumlah `side_three` |
| f3 | `outer_low+inner_low` |
| f4..f8 | `outer_low, inner_low, c, inner_high, outer_high` |
| f9..f14 | Enam panjang langkah, dalam urutan kontur |
| f15 | 1 bila pusat sama dengan maksimum kelima a; 0 jika tidak |
| f16 | Minimum empat `neighbors` |
| f17 | Elemen indeks 1 dari empat `neighbors` setelah pengurutan (kedua terkecil) |
| f18 | Simpangan baku populasi empat `neighbors` |
| f19 | Median `side_three` |
| f20 | Simpangan baku populasi `side_three` |

Bukti orientasi sisi dan penyimpanan f4..f8: `0x1000c3dbc–0x1000c3e24`; f15: `0x1000c3e4b–0x1000c3e89`; f16 dan simpangan baku empat tetangga: `0x1000c3f77–0x1000c4009`; seleksi statistik lainnya sampai `0x1000c41d8`. Jendela bergeser satu node; koordinat tidak diubah oleh fungsi puncture ini.

**Batas kepastian:** pemetaan fitur merupakan rekonstruksi statis dan tersedia sebagai referensi Python. Belum ada pembandingan buffer fitur asli dari aplikasi berjalan; kesetaraan bit demi bit untuk pembulatan, NaN, dan koordinat degenerat belum diklaim.

## 4. Pohon keputusan corner berhasil dipulihkan

Caller memanggil fungsi global `isProbablyPuncturedNode(Vec<double,21> const&, int)` pada `0x1000c41e9`, dengan argumen integer 0. Implementasinya berada pada `[0x1000f1b70, 0x1000f1c60)`, dan tidak membaca argumen integer tersebut. Simbol `isProbablyPuncturedNodeOld` juga ada, tetapi bukan target call ini.

Hanya enam fitur yang dibaca: **f0, f2, f6, f8, f15, f16**. Berikut pseudocode untuk input finite, dengan tanda ketaksamaan sesuai instruksi:

```text
c = f6
if c < 0.611194:
    if c < 0.282594 or f0 >= 0.322933:
        return false
    return c >= 0.483023 or f0 < 0.0286571 or f2 < 0.00209524

if f15 < 0.5:
    return c >= 1.72002

if f16 >= 0.097537:
    return false

return c >= 1.42496 or f2 < 0.122841 or f0 < 0.445642 or f8 < 0.0046405
```

Konstanta dibaca langsung dari data RIP-relative pada `0x1002ec290–0x1002ec2e8` dan konstanta 0,5 pada `0x100160740`. [Disassembly classifier](phase5/isProbablyPuncturedNode-1000f1b70.annotated.txt) mencatat alamat setiap compare dan jump.

Aturannya memperhitungkan kekuatan belokan serta konteks tetangga. Bukan satu threshold sudut tunggal. Pusat juga tidak selalu diwajibkan menjadi maksimum lokal: cabang `f15<0.5` masih dapat menerima belokan kuat `c>=1.72002`. Tidak ada bukti yang cukup untuk menyatakan apakah ambang tersebut dipilih manual atau dilatih dari data.

Bila diterima, caller menulis **tipe node=3** pada `node+0x1c` dan melakukan OR **mask 0x1** pada flag elemen kontur terkait (`0x1000c4205`, `0x1000c4224`). Terpisah dari keputusan akhir, maksimum lokal menambahkan mask **0x8** pada elemen kontur (`0x1000c3f19`). Maksimum lokal dan corner yang diterima merupakan dua penanda berbeda.

## 5. State node menghubungkan corner dengan fitting

`BezierFitter::initialize` tidak menghapus seluruh penanda. Operasi bit dan konstanta pada `0x1000b8904–0x1000b8933` menghasilkan:

```text
1 → 0
2 → 0
4 → 3
5 → 0
3 tetap 3; nilai lain tidak diubah oleh cabang ini
```

Makna operasional dari penggunaan di jalur yang diperiksa:

| Nilai byte +0x1c | Penggunaan yang teramati |
|---|---|
| 0 | Node yang dapat ditelusuri saat segmentasi fragmen awal |
| 1 | Interior fragmen terpilih, belum diproses fitting akhir |
| 2 | Sampel interior yang sudah ditandai oleh fitting akhir |
| 3 | Anchor sebelum pemilihan fragmen: corner/junction/batas tertentu |
| 4 | Kedua endpoint rentang setelah `selectKeepers` |
| 5 | Keeper/batas fragmen internal setelah penyederhanaan |

Ini adalah satu field state byte, bukan sekumpulan bit independen. Byte node `+0x1d` untuk flag cleanup dan flag elemen kontur adalah lokasi lain.

`followContour(region,start,direction,state)` memulai dari tetangga berikutnya, berputar pada indeks region, lalu berhenti pada node dengan state berbeda atau saat kembali ke node awal. `segmentContours` menjalankannya dua arah pada setiap node bertipe 0; `end` dinormalisasi menjadi indeks maju sesudah `start`. Bila tidak ada anchor pada satu loop, penelusuran kembali ke node asal menghasilkan satu rentang sepanjang loop. Pengujian identitas node awal terlihat pada `0x1000b940b`; normalisasi rentang pada `0x1000b8a32–0x1000b8a4f`.

Karena itu sudut yang ditandai puncture memengaruhi batas rentang tempat merge/swap diperbolehkan bekerja. Fungsi puncture sendiri tidak menghapus titik atau memanggil pembagi kurva.

## 6. Fragmen dimulai dari panjang satu langkah

`initializeFragments(region,start,end)` menyimpan region pada fitter `+0x108`, start pada `+0x10c`, dan jumlah record `end-start+1` pada `+0x6c`. Setiap record berukuran 32 byte:

| Offset record | Inisialisasi dan penggunaan |
|---|---|
| +0x00 | Indeks relatif i |
| +0x04 | Panjang rentang 1 |
| +0x08 | Pointer record berikutnya; record terakhir bernilai null |
| +0x10 | Cached cost, awalnya 0 |
| +0x18 | Cache dirty, awalnya 1 |

`computeSelfCost` menerjemahkannya ke endpoint `start+i` dan `start+i+length`, sehingga fragmen awal panjang 1 memiliki **nol sampel interior**. Pada rantai terdapat record terminal untuk batas akhir; pemeriksaan `next` dan `next->next` di loop (`0x1000bbe50–0x1000bbe66`) melindungi record terminal dari pasangan merge biasa. Jumlah record tidak otomatis sama dengan jumlah kurva kubik yang diekspor.

Urutan yang terkonfirmasi:

```text
selectKeepers(region, start, end):
    mergeAndSwapLoop(region, start, end)  # inisialisasi unit fragments di dalamnya
    untuk record yang bertahan:
        tandai node awal record sebagai 5
        tandai node interior sebagai 1 dan simpan ID kurva di node+0x18
    ubah kedua endpoint rentang menjadi 4

fitBezierCurves():
    cari node state 1
    telusuri dua arah sampai batas state berbeda
    ambil slot kurva dari node+0x18
    fitBezierCurve(..., mark_samples=true)  # interior berubah menjadi 2
```

Alamat penanda keeper: `0x1000b94d6`; ID kurva: `0x1000b9534`; interior: `0x1000b954d`; endpoint: `0x1000b9589` dan `0x1000b95b9`. Konsumsi state 1 pada fitting akhir: `0x1000b8b80`; call fitter: `0x1000b8c1b`.

**Hubungan dengan cabang pendek tahap 4:** fragmen panjang 2 memiliki satu sampel interior, panjang 3 memiliki dua sampel interior. Penggabungan unit fragments dapat membentuk panjang tersebut secara struktural. Jadi cabang `n=2` tidak layak diabaikan sebagai cabang yang mustahil dicapai hanya karena perilakunya tidak lazim. Frekuensi kejadian dan dampak hasil visual tetap perlu dibuktikan dengan runtime.

## 7. Verifikasi dan artefak

- [function-boundaries.json](phase5/function-boundaries.json): 29 fungsi dengan batas LC_FUNCTION_STARTS dan berkas bukti.
- [direct-references.json](phase5/direct-references.json): 437 referensi langsung dari/ke fungsi pilihan, termasuk helper dan library.
- [phase5_corner_reference.py](scripts/phase5_corner_reference.py): rekonstruksi fitur dan classifier; hanya referensi penelitian.
- [validate_phase5.py](scripts/validate_phase5.py): interpreter kecil untuk instruksi pembanding/cabang classifier, dibandingkan dengan pseudocode.
- [validation-summary.json](phase5/validation-summary.json): **14.680 vektor fitur**, mencakup kedua hasil dari seluruh **10 conditional jump**. Pengujian mencakup nilai ambang tepat serta double representabel sebelum/sesudahnya.

Contoh referensi geometrik: tujuh titik lurus ditolak; belokan 90° terisolasi diterima; loop empat titik melewati pass karena panjangnya kurang dari tujuh. Ini hasil rekonstruksi, bukan hasil menjalankan Vector Magic.

```sh
python3 RND/vector-magic-analysis/scripts/extract_phase5.py
python3 RND/vector-magic-analysis/scripts/validate_phase5.py
```

Extractor menerima `--source` dan `--output`. Input default memakai hasil ekstraksi/disassembly sesi sebelumnya di `/private/tmp/vm-analysis-mac`. Manifest menyimpan hash slice. Satu decode padding objdump yang melintasi awal fungsi berikutnya diabaikan dan dicatat pada manifest; tidak memengaruhi instruksi classifier sampai return.

## 8. Apa yang selesai dan yang masih terbuka

Tahap ini memulihkan aturan corner yang dipanggil jalur smoothing, pembentukan unit fragments, perubahan state, serta hubungan keduanya dengan fitting. Ini memperkuat dasar prototipe kontur dalam Rust.

Yang belum selesai adalah keseluruhan aturan tracing pada kasus diagonal/junction ambigu, `patternMatch` dan cleanup sampling, seluruh kebijakan segmentasi region, serta validasi output lintas Windows/macOS. Ekstraksi fungsi dalam folder bukti bukan berarti semua fungsi tersebut sudah direkonstruksi penuh. Belum ada engine raster-ke-vektor baru yang diintegrasikan ke Tauri.

Kelanjutan yang paling bernilai adalah menyelesaikan tracing dan cleanup, karena keduanya menentukan urutan/jarak sampel yang menjadi input fitur corner dan biaya Bézier. Validasi dinamis kemudian membandingkan buffer kontur, fitur, dan hasil SVG pada gambar sintetis yang sama.

**Pembaruan tahap 6:** tabel `patternMatch`, penerapan mask cleanup, dan kaitannya dengan `Shared::is_anti_aliased` sudah dipulihkan dalam [laporan tahap 6](phase6-findings.md). Aturan tracing ambigu dan validasi dinamis masih terbuka.
