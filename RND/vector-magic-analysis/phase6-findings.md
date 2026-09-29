# Tahap 6 — Pola pembersihan sampel kontur

Tahap ini menjawab sebagian celah [tahap 5](phase5-findings.md): `BoundaryTracer::patternMatch` dan pemakaian hasilnya dalam `removeRedundantNodes`. Enam pola statis berhasil diekstraksi dari binary macOS 1.21 dan `engine_project.dll` Windows 1.21. **Seluruh 1.536 byte tabel itu identik**, bukan hanya nilai pola yang diterjemahkan. Ini bukti lintas platform untuk *data* aturan cleanup. Pemeriksaan tetap statis; aplikasi target belum dijalankan.

## 1. Struktur dan prioritas tabel

Konstruktor `BoundaryTracer` pada `0x1000bf2b2–0x1000bf3e8` mengalokasikan enam rekaman kompak, masing-masing `(panjang, nilai_pola, mask_simpan)` berupa tiga integer 32-bit. Ia membaca enam rekaman sumber `_expanded_patterns`, 256 byte per rekaman. Dalam tiap sumber: panjang berada pada word 0; `panjang` bit pola ada mulai word 1; `panjang+1` bit mask titik ada mulai word 32. Bit digabung dari urutan lama ke baru dengan pergeseran kiri, sehingga digit paling kanan dalam tabel berikut berlaku bagi langkah/titik terbaru.

| Prioritas | Panjang langkah | Pola sumbu (`x` **atau** `y`) | Nilai | Mask titik lama→baru | Nilai mask |
|---:|---:|---|---:|---|---:|
| 0 | 5 | `00000` | `0x0` | `100001` | `0x21` |
| 1 | 9 | `010101010` | `0xaa` | `1001001001` | `0x249` |
| 2 | 9 | `010010010` | `0x92` | `1001001001` | `0x249` |
| 3 | 13 | `1000100010001` | `0x1111` | `10000100100001` | `0x2121` |
| 4 | 10 | `0010000100` | `0x84` | `10000100001` | `0x421` |
| 5 | 10 | `0101001010` | `0x14a` | `10000100001` | `0x421` |

`patternMatch` (`0x1000c15e0–0x1000c16b9`) menelusuri rekaman berurutan. Ia melewati pola yang lebih panjang daripada jumlah langkah tersedia, lalu membandingkan `x_bits & ((1<<panjang)-1)` **atau** `y_bits & mask` dengan satu nilai pola yang sama. Hasil pertama yang cocok menang; fungsi mengembalikan panjang dan menulis mask titik ke argumen keluaran. Bila tak ada yang cocok, ia mengembalikan 0 dan tidak menulis keluaran. Karena prioritas didahulukan, ini bukan pencarian pola terpanjang. Contoh: bila lima langkah terakhir pada sumbu `x` adalah `00000`, pola 0 menang walau sumbu `y` cocok dengan pola lebih panjang.

Pola memeriksa apakah perpindahan terkuantisasi pada **satu sumbu** nol atau tidak; pola tidak mengkodekan besar perpindahan atau biaya fitting Bézier. Contoh pola 0 menjaga dua ujung dari enam titik dan menandai empat titik tengah bila seluruh syarat konteks cleanup terpenuhi. Mask pada tabel tidak boleh diterapkan mentah pada kontur yang belum melalui pemeriksaan proteksi.

## 2. Dari koordinat ke bit, lalu ke node yang dibuang

`removeRedundantNodes` membaca koordinat double dua node bertetangga, mengurangkan, memberi offset bertanda dekat `0,5`, dan membulatkan ke integer dengan `roundpd` mode truncation (`0x1000c1178–0x1000c11a6`). Tiap komponen integer menghasilkan bit `1` jika bukan nol, `0` jika nol. Dua register menumpuk riwayat bit `x` dan `y` secara terpisah (`0x1000c11f2–0x1000c1218`). Bila dua delta berurutan pada suatu sumbu sama-sama bukan nol tetapi berbeda nilai integer bertanda, riwayat direset (`0x1000c11b9–0x1000c11f0`); jadi pencocokan tidak menyeberangi perubahan langkah semacam itu.

Fungsi baru memanggil matcher setelah sedikitnya lima langkah tersedia (`0x1000c1229–0x1000c124d`). Panjang input matcher dibatasi maksimum 31 pada `0x1000c121c–0x1000c1227`. Jika ada kecocokan, ia berjalan mundur sepanjang `panjang+1` node; bit mask `0` mengeset `0xc0` pada flag node `+0x1d`, sedangkan bit `1` membiarkan node tersebut (`0x1000c125e–0x1000c12a7`). Bit `0x40` kemudian dipakai untuk melewati node saat menyalin node yang bertahan, sambil membangun peta indeks lama→baru (`0x1000c0e89–0x1000c0ea3`). Bagian akhir memetakan ulang indeks kontur dan mengecilkan jumlah node/elemen kontur (`0x1000c1378–0x1000c140f`). Ini mengonfirmasi bahwa mask tersebut benar-benar mengubah sampel yang mencapai smoothing dan fitting.

Pemeriksaan perlindungan terjadi sebelum penumpukan bit: node yang sudah bertanda `0x40`, node berikutnya dengan bit `0x80`, dan pasangan yang salah satunya bertipe 3 memutus jendela pencocokan (`0x1000c112d–0x1000c1166`). Loop awal juga melindungi tipe 3 saat menandai kandidat node tepi gambar (`0x1000c0d69–0x1000c0d8f`). Jalur pola panjang hanya masuk untuk region dengan sedikitnya 20 node (`0x1000c1060`) dan bila argumen bool `removeRedundantNodes` bernilai false serta jumlah region positif (`0x1000c0de8–0x1000c0dfa`). Bool itu adalah `Shared::is_anti_aliased`: `CoreEngine::registerParameters` mengaitkan nama tersebut ke offset `+0x36c` (`0x1000d8950–0x1000d899a`), konstruktor tracer menyimpan pointer ke `CoreEngine+0x368` pada field `+0x30` (`0x1000bf239–0x1000bf240`), dan `execute` membaca `+4` dari pointer itu (`0x1000bfd3a–0x1000bfd4b`). Dengan demikian pencocokan pola panjang berlaku pada jalur **non-antialias**. Pembersihan awal node tepi dan kompaksi tetap terjadi pada jalur antialias.

## 3. Apa arti temuan ini untuk implementasi

Untuk prototipe mesin Tauri/Rust, pola dapat dipakai pada jalur non-antialias setelah label region, urutan kontur tertutup, tipe node/junction, dan koordinat awal sudah benar. Simpan node penting, jalankan jendela bit pada pasangan node, terapkan mask sebagai keputusan penghapusan, kemudian bangun ulang indeks kontur sebelum menghitung fitur corner dan biaya Bézier. Urutan ini penting: kesalahan menghapus satu node mengubah tetangga fitur tujuh titik pada tahap 5 dan jarak/kandidat merge tahap 4.

Tabel yang sama di dua platform memberi prioritas pengujian yang jelas: buat kontur sintetis lurus, diagonal berulang, tikungan, simpul tiga region, dan tepi gambar; bandingkan **urutan dan jumlah node** pasca-cleanup sebelum membandingkan SVG. Ini masih rancangan validasi. Kesamaan output engine lintas platform belum terbukti.

## 4. Bukti dan batas

- [expanded-patterns.json](phase6/expanded-patterns.json) memuat keenam rekaman, SHA-256 slice macOS dan DLL Windows, serta hasil perbandingan byte.
- [extract_phase6_patterns.py](scripts/extract_phase6_patterns.py) mengekstraksi tabel dari kedua binary, memastikan 1.536 byte identik, dan memeriksa 15 kasus matcher referensi (kedua sumbu, prioritas, batas panjang, tanpa kecocokan). Jalankan dengan `python3 RND/vector-magic-analysis/scripts/extract_phase6_patterns.py`. Path input dapat diganti lewat `--mac` dan `--windows`; skrip tidak menjalankan target.
- Disassembly pembanding: [konstruktor](phase5/BoundaryTracer-BoundaryTracer-1000bf200.annotated.txt), [matcher](phase5/BoundaryTracer-patternMatch-1000c15e0.annotated.txt), [cleanup](phase5/BoundaryTracer-removeRedundantNodes-1000c0cd0.annotated.txt), [caller](phase5/BoundaryTracer-execute-1000bf750.annotated.txt), dan [registrasi parameter](phase3/CoreEngine-registerParameters.annotated.txt).
- Lokasi sumber tabel: Mach-O x86_64 `_expanded_patterns` pada `0x100302ec0`; ekspor PE `expanded_patterns` pada RVA `0x90020` (section `.data`). Identitas tabel tidak dengan sendirinya membuktikan identitas seluruh *control flow* macOS/Windows.

Aturan tracing untuk junction/diagonal ambigu, kebijakan segmentasi region, serta pemeriksaan buffer/output aplikasi berjalan masih terbuka. Tahap ini memulihkan satu komponen cleanup, belum keseluruhan mesin vectorize.

**Pembaruan tahap 7:** aturan kandidat dan keputusan arah lokal pada diagonal/junction telah dipulihkan di [laporan tahap 7](phase7-findings.md). Siklus lengkap dan validasi runtime tetap terbuka.
