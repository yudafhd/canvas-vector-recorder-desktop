# Integrasi engine mini-vectorizer

## Pembaruan mesin 7 Oktober 2026

Port mengikuti sumber Java produksi dan perubahan lokal terbaru di mini-vectorizer, termasuk `AutoWhitePolicy`. Sumber mini-vectorizer tidak diubah.

- `quantizeFlatInteriors` belajar warna dari piksel dengan minimal delapan tetangga koheren. Training memerlukan minimal 64 piksel foreground dan cakupan foreground stabil 60%; input yang tidak memenuhi syarat memakai quantizer biasa. Pipeline artwork mengaktifkannya untuk smooth, minimal delapan warna, cleanup minimal empat piksel, dan mode background.
- Penggabungan palet mempertahankan warna isian yang didukung sumber. Warna hasil interior training hanya digabungkan jika RGB hampir duplikat. Bayangan kuning/oranye yang disengaja tetap dipertahankan.
- Pembersihan pasangan warna memakai toleransi JPEG dari Java ketika interior training aktif. `transition-mixtures.ts` menambahkan solver simplex RGB hingga enam warna, evidence region, pemeriksaan luminance/chroma, serta penjagaan konektivitas lokal sebelum penggantian label. Region tipis dengan dukungan sumber dan batas alpha tidak memenuhi syarat pembersihan. Merge fragmen tepi kecil mengikuti batas ukuran, kedalaman, dukungan sumber dan warna tetangga dari Java.
- Perapian C1 pada shared chain menggeser handle sepanjang tangent maksimum 0,24 px, menjaga endpoint dan sudut, menolak persilangan, lalu diterima hanya jika energi coverage tidak meningkat. Statistik fairing tersedia pada diagnostics.
- `underpaint.ts` mengisi celah antarbentuk berwarna dengan strip yang dibatasi clip domain. Lapisan tinta yang terlihat kemudian dikecualikan dari domain. Evaluator scene mendukung winding nonzero untuk clip; eksportir EPS browser dan Rust menghasilkan operator `clip` dan melewati path definitions.
- Rekomendasi Auto menyimpan `detectedColors`, terpisah dari batas palet yang diminta. Default background memakai `all` ketika artwork terdeteksi dua warna dan `background` untuk jumlah lain. Preferensi `none`/`all` selalu dihormati. Editor menyediakan Default putih Auto yang disimpan lokal; menggantinya menghapus rekomendasi lama dan mengantrekan ulang hasil Auto. Manual tetap memakai pilihan per item.
- Ilustrasi besar dengan latar putih, minimal delapan warna, serta tanpa grain/detail tipis/tinta monokrom memakai 2048 px, 16 warna, toleransi 0,8 dan cleanup 12. Worker menerima ukuran sumber asli pada deteksi dan tracing.

Pengujian tambahan berada di `tests/engine-update.test.mjs`: palet antialias versus bayangan asli, fallback training, kebijakan putih, fitting junction tiga warna, penjagaan topologi, aksen tipis/alpha, underpaint dengan tinta, evaluator clip serta EPS. Ekspektasi Auto lama diperbarui mengikuti kebijakan putih terbaru. Batas adaptasi desktop dijelaskan di bawah; kesamaan pada sampel audit tidak menjamin identitas byte untuk semua gambar dan platform.

Audit opsional `node tests/mini-engine-parity.mjs [direktori-sumber-Java]` mengompilasi sumber Java produksi dari proyek mini-vectorizer, kemudian membandingkan 40 fitting simplex (dua sampai enam warna), palet interior dan 3.072 label piksel dengan port TypeScript. Audit ini lulus pada sumber lokal terbaru. Report ditulis ke `build/mini-engine-parity/report.json`; tidak membutuhkan runtime Android.

## Pemeriksaan ulang seluruh pipeline

Audit kedua menemukan beberapa bagian yang belum sama dengan Java, lalu memperbaikinya:

| Tahap | Koreksi dan bukti |
| --- | --- |
| `AutoFinalTracer.refineFinal` | Tambahkan percobaan palet 16 warna pada ukuran akhir, dengan batas percobaan, pertumbuhan path/segmen, peningkatan error minimal 5%, skor minimal 2%, dan penjagaan error tepi. Metadata memakai fallback `palette`. |
| `VectorSession` / `AutoWhitePolicy` | Hitung ulang jumlah warna pada preview yang benar-benar dipakai selector, sebelum menetapkan mode hapus putih. |
| `Run.trace` / `hiddenRegions` | Pertahankan label putih saat fitting; putih disembunyikan saat ekspor. Coverage dan pemeriksaan kurva kini aktif pada none/background/all. Raster prediction memakai Float32 seperti Java. |
| `CurveQuality.finish` | Sampling cubic akhir memakai jumlah sampel dense yang sama dengan Java. Masker detail hanya aktif pada kandidat protected; smooth tanpa cleanup juga membandingkan kandidat detail. |
| `straightSpans` | Split sebelum simplifikasi pada sudut yang dijaga; dukung stem minimal 12 px dan bedakan lengkung pendek dari noise berosilasi. |
| `consolidateRasterTips` | Batasi rekonstruksi cap raster pada empat lobus tajam dengan sisi inset. Kembalikan sudut asli jika bentuk tidak memenuhi syarat. Ini memperbaiki selisih pada panah, wajah dan siluet. |
| Normalisasi tangent | Gunakan aritmetika dua kanal `NativeTraceEngine.hypot`, termasuk optimasi angular dan regularisasi stroke. |

Penggabungan warna tetangga diperiksa pada sumber Java langsung:

- `compactPalette` memakai jarak Oklab, hue, dan dukungan batas bersama; dua isian sumber yang koheren dilindungi. Warna interior-trained hanya digabungkan jika hampir duplikat dalam RGB.
- `cleanRegions` memilih tetangga berdasarkan panjang batas dibagi `1 + jarak Oklab`; region kecil yang didukung sumber tidak dibuang hanya karena luasnya kecil.
- `regularizeShadeLabels` memperbaiki label shade terisolasi dalam keluarga hue yang sama.
- `cleanTransitionPairs`, simplex mixture, dan luminance/chroma repair membuang pita warna palsu antialias/JPEG dengan dukungan sumber serta penjagaan topologi.
- `mergeSmallEdgeRegions` memakai ukuran region, ketebalan, kontak dengan tinta, jarak warna, dan bukti sumber sebelum menyatukan fragmen dengan tetangga.

`tests/mini-engine-review.mjs` mengompilasi mesin Java yang sedang ada di workspace, bukan baseline TypeScript. Audit memakai 56 konfigurasi standard/protected: 392 pemeriksaan palet, label, detail-mask dan diagnostics, serta 56 pemeriksaan rekomendasi Auto. Semua cocok. Pada 28 tracing akhir, termasuk empat gambar nyata (panah, wajah, weightlifter-green dan monochrome-silhouette-sheet) yang disampel maksimum 128 px, SVG akhir identik dengan Java, termasuk path, kontur, segmen, error raster dan error tepi. Audit juga mencakup delapan raster deterministik untuk noise JPEG, junction warna, ambang alpha 127/128/180/239 dan palet 2–16 warna, serta fixture yang menghasilkan underpaint dari engine produksi. Kesamaan byte SVG kini diwajibkan oleh assertion. Report dan pasangan SVG tersedia di `build/mini-engine-review/`.

Audit juga diulang dengan maksimum 512 px untuk keempat gambar nyata, melalui `node tests/mini-engine-review.mjs ../mini-vectorizer/app/src/main/java/com/mini/vectorizer 512`. Semua pemeriksaan kembali cocok dan seluruh 28 SVG identik; report ada di `build/mini-engine-review-512/report.json`. Total kedua audit: 784 tahap segmentasi, 112 rekomendasi Auto, dan 56 tracing akhir. Lembar siluet pada audit 512 menghasilkan 98 path dan 1.734 segmen di kedua engine. Fixture underpaint menghasilkan satu clip domain, dua strip, enam path dan 34 segmen di keduanya.

Jalankan `npm run test:mini-engine` untuk audit simplex dan pipeline 128 px; perintah 512 px di atas mengulang pipeline pada ukuran lebih besar. JDK dan proyek sumber mini-vectorizer diperlukan. `npm test` (compile, 125 tes frontend dan 31 tes Rust), `npm run build`, serta `git diff --check` lulus setelah pemeriksaan akhir.

## Pemeriksaan akhir jalur ekspor

Pemeriksaan melalui serializer yang dipakai tombol Simpan menemukan celah yang tidak terlihat pada audit geometri: validator desktop masih menolak `defs`/`clipPath`, eksportir EPS Online yang dipakai Offline belum menerapkan clip, dan layout browser membuang definisi clip sambil mengambil path di dalamnya sebagai artwork. Hasil underpaint dapat gagal disimpan atau kehilangan batas clip.

- `validate_tracing_svg` kini menerima definisi clip lokal dari engine, memeriksa ID unik dan referensi yang tersedia, serta tetap menolak elemen aktif, referensi eksternal, atribut asing dan struktur clip yang tidak didukung. Validator yang sama dipakai ekspor SVG dan ZIP batch.
- `build_svg_asset_eps` dan `build_tracing_eps` memakai resolver clip yang sama. Clip diterapkan di dalam transform artwork/path sebelum fill; winding nonzero mempertahankan lubang tinta, dan path di dalam definitions tidak dilukis.
- `export-render.ts` mempertahankan definitions tanpa transform tambahan. Hanya path artwork yang menerima matriks layout; clip mengikuti sistem koordinat path tersebut pada SVG dan EPS browser.

Regresi `tests/stock-export.test.mjs` menjalankan renderer browser produksi dengan host native disimulasikan. Tes Rust memanggil `render_tracing_export` dan pembuatan ZIP produksi. Keduanya mencakup clip berlubang, perubahan rasio/skala, definitions yang tidak dilukis, serta penolakan referensi clip tidak valid. Tes ekspor baru gagal pada kode sebelum koreksi dan lulus setelahnya.

## Analisis

Engine produksi mini-vectorizer berada di `app/src/main/java/com/mini/vectorizer/NativeTraceEngine.java`, bukan `tests/reference/engine.ts`. File referensi TypeScript adalah baseline desktop lama untuk pengujian kernel. Engine Java mempertahankan histogram, kontur berbagi batas, fitting Bézier, classifier sudut, dan optimasi coverage dari baseline, lalu menambahkan:

| Komponen sumber | Fungsi | Integrasi desktop |
| --- | --- | --- |
| `PerceptualColor` | Oklab untuk jarak warna | Histogram clustering, penggabungan palet, pemilihan pengganti region |
| `NativeTraceEngine.compactPalette` | Penggabungan shade dengan dukungan batas bersama | Ambang Oklab, kesamaan hue, dan jumlah batas bersama |
| `DetailProtection` | Menjaga pasangan piksel koheren dan garis tipis | Jarak ketebalan dua lintasan, masker warna, pemulihan label setelah cleanup |
| `CurveQuality` | Menilai kurva SVG akhir terhadap raster | Integrasi scanline empat sampel, refit, penalti kompleksitas/kurvatur, pemeriksaan persilangan |
| `CurveQuality.ellipse` | Fitting conic pada loop halus | Elips empat cubic, pencarian parameter terbatas, penerimaan berdasarkan coverage |
| `NativeTraceEngine.hiddenRegions` | Penghapusan putih | Mode none/background/all dengan flood fill empat tetangga |
| `AutoSettingsDetector` | Pengaturan awal dari karakter gambar | Deteksi Oklab, foto/grain, garis tipis, tinta monokrom, latar putih |
| `AutoTraceSelector` | Memilih beberapa kandidat pratinjau | Maksimum tiga kandidat, penilaian SVG aktual, baseline memenangkan seri |
| `AutoFinalTracer` | Pemeriksaan hasil resolusi akhir | Perbandingan ulang baseline, refit detail terbatas, retry dan fallback 2048 → 1024 → 512 px |
| `SvgSceneQuality` | Evaluasi SVG terhadap raster | Error RGBA, masker detail, tepi dan tile 16 px; pemilihan tracing standar/protected dan penjagaan perubahan global |
| `StrokeRegularizer` | Perapian global kontur | Fairing dengan pasangan sisi garis, balancing kurvatur, penjagaan sudut dan pemeriksaan SVG sebelum diterima |

Implementasi inti berada di `src/tracing/engine.ts`; alur Auto berada di `auto-settings.ts`, `auto-trace.ts`, `auto-raster.ts`, dan `scene-quality.ts`. Worker tetap menjalankan semuanya lokal. UI membuka mode Auto secara default, mendeteksi pengaturan saat gambar dibuka, lalu menjalankan seleksi dan pemeriksaan penuh saat Mulai tracing dipilih. Ringkasan hasil menampilkan pengaturan yang benar-benar dipakai dan penyesuaian/fallback. Mode Manual menyediakan pengaturan penuh termasuk mempertahankan putih, menghapus latar saja, atau menghapus seluruh bidang putih. Pemanggil lama dengan `removeWhite` tetap kompatibel; `whiteMode` eksplisit memiliki prioritas.

## UI Auto/Manual (poin 9)

Deteksi awal berjalan dalam worker terpisah dari pekerjaan tracing, dengan raster maksimum 1024 px dan ukuran sumber asli untuk rekomendasi resolusi. Deteksi tidak menghasilkan SVG. Tracing Auto tetap memeriksa ulang rekomendasi pada raster proses maksimum 2048 px. Mengganti gambar, mengubah pengaturan, atau memulai tracing menghentikan worker sebelumnya; generation guard menolak balasan terlambat.

Pengaturan kini mengikuti item seperti `VectorViewModel.setSettingsMode` pada mobile. Setiap item menyimpan konfigurasi saat ini dan `autoSettings` sendiri; hasil Auto memperbarui konfigurasi dengan opsi akhir/fallback yang benar-benar dipakai. Beralih dari Auto ke Manual mengambil opsi Auto item tersebut sebagai nilai awal Manual. Edit Manual hanya mengubah item terpilih. Kembali ke Auto mengambil lagi opsi Auto item yang sama. Perubahan mode/parameter membuang hasil lama item itu dan mengantrekannya ulang; hasil item lain tetap tersimpan. `settings-state.ts` menyediakan snapshot editor dan validasi nilai, sedangkan persistensi konfigurasi berada pada record per item di IndexedDB.

Penomoran rencana yang dikonfirmasi pengguna menempatkan batch/persistensi pada poin 10 dan validasi keseluruhan desktop/APK pada poin 11. Poin 10 dijelaskan di bawah; perbandingan keseluruhan dengan APK masih belum dilakukan.

## Batch dan persistensi (poin 10)

Halaman awal menampilkan daftar gambar, termasuk ketika hanya satu gambar ditambahkan. Tambah gambar dan drag-drop menerima PNG/JPG/WebP; upload dari editor juga kembali ke daftar. Batasnya 50 gambar, 20 MB per sumber, dan 200 MB total. Item baru memulai mode Auto tanpa mewarisi Manual item lain. Klik baris/nama/Buka tracing membuka editor raster/SVG yang sama; Kembali ke daftar menutup editor tanpa membuang konfigurasi atau hasil item. Rekomendasi awal dideteksi saat item pertama kali dibuka; tracing Auto mendeteksi ulang setiap gambar secara mandiri.

Antrean berjalan berurutan dengan satu worker aktif. Progres, sukses dan pesan kegagalan ditampilkan per gambar. Kegagalan satu pekerjaan tidak menghentikan berikutnya. Batalkan batch menghentikan worker aktif dan mempertahankan hasil yang telah selesai; pekerjaan aktif kembali menunggu dan dapat dilanjutkan melalui Proses antrean. Coba ulang memakai konfigurasi item tersimpan. Mulai tracing dalam editor memproses hanya item terpilih melalui runner yang sama dengan batch, menyimpan hasil ke item itu, dan tidak memproses pending item lain. Simpan SVG mengekspor hasil item terpilih; Simpan ZIP hasil di daftar mengekspor seluruh hasil sukses. Berpindah item memulihkan mode, parameter dan hasil dari record item, tanpa memakai konfigurasi global.

IndexedDB `cvr-tracing-batch` menyimpan sumber sebagai File/Blob dan status, konfigurasi serta hasil sebagai record terpisah. Sumber ditulis saat penambahan; checkpoint status disimpan dalam transaksi berurutan saat penambahan, mulai/selesai pekerjaan, gagal, batal, retry atau penghapusan. Progres sementara diperbarui di UI tanpa penulisan berulang. Status processing dipersistensikan sebagai pending agar penutupan aplikasi tidak mengunci pekerjaan. Pembukaan halaman memulihkan urutan, sumber, konfigurasi, hasil sukses, dan kegagalan. Antrean tidak otomatis mulai setelah pemulihan.

Hapus/Kosongkan antrean menghapus cache batch, tanpa mengubah file asli di komputer. Bila kuota/penyimpanan lokal gagal, panel menjelaskan bahwa antrean belum tersimpan; hasil sesi tetap tersedia untuk ekspor. Cache mengikuti profil penyimpanan WebView: menghapus data aplikasi menghapus antrean. Checkpoint yang masih bertuliskan Menyimpan antrean mungkin belum selesai saat aplikasi ditutup, sehingga pekerjaan terakhir dapat kembali menunggu.

Simpan ZIP hasil memasukkan hanya hasil sukses dengan nama SVG aman dan unik termasuk perbedaan kapitalisasi. Browser menghasilkan ZIP lokal; desktop memvalidasi seluruh SVG lalu membuat ZIP pada thread blocking di luar UI, menyimpan ke Downloads dengan nama unik `tracing-batch.zip`. Batas hasil adalah 2 MB per SVG dan 100 MB per ZIP. ZIP memakai metode store tanpa kompresi tambahan. Ukuran dokumen SVG tetap mengikuti sumber asli; viewBox tetap mengikuti resolusi tracing/fallback.

Komponen: `batch.ts` untuk antrean/persistensi, `file-task.ts` untuk decode/worker/pembatalan, `batch-page.ts` untuk UI, `batch-zip.ts` untuk ekspor browser, dan `src-tauri/src/tracing_batch.rs` untuk ZIP desktop. `fake-indexeddb` dan `happy-dom` hanya dependency pengujian; tidak masuk bundle aplikasi.

## Alur Auto

1. UI menyediakan raster maksimum 2048 px. Worker menganalisis sampel maksimum 256 px; safeguard grain memeriksa sampel 1024 apabila tekstur dapat tersembunyi dalam sampel kecil.
2. Detektor mengevaluasi palet 2/4/6/8/12 warna dalam sampel 96 px. Foto memakai resolusi 512; artwork biasanya memakai 1024. Tinta monokrom pada sumber lebih besar dari 1024, atau artwork dengan detail tipis pada sumber lebih besar dari 1536, memakai 2048. Tinta monokrom jarang memakai dua warna dan toleransi 0,2. Preferensi default background menghapus semua putih pada artwork dua warna; artwork lainnya memakai background. Pilihan none/all selalu dihormati.
3. Selector membandingkan maksimum tiga tracing pada pratinjau 192 px (128 untuk pengaturan foto). Skor memakai error SVG, error tepi dan penalti kompleksitas. Penggantian baseline memerlukan peningkatan skor setidaknya 2% dengan pembatas error gambar.
4. Final tracer memeriksa hasil resolusi akhir, membandingkan kembali rekomendasi awal apabila pilihan preview berbeda, mencoba palet 16 warna pada artwork background yang memenuhi syarat, serta mencoba toleransi 0,35/0,2 jika error tepi masih berarti. Refit detail memerlukan topology tetap, pertumbuhan segmen terbatas, error global tidak memburuk, error tepi turun minimal 2%, dan batas kerusakan per tile.
5. Kegagalan atau SVG yang melampaui 2.000 path / 12.000 segmen / 2 MB memicu pilihan lebih sederhana. Jika diperlukan, Auto mencoba tingkat resolusi lebih rendah: 2048 → 1024 → 512, masing-masing sekali dengan resampling premultiplied alpha dari raster awal. Kegagalan seluruh kandidat preview tetap diteruskan ke tracing akhir; pembatalan menghentikan alur tanpa retry. Hasil mempertahankan viewBox resolusi proses yang sebenarnya; UI mengembalikan width/height dokumen ke ukuran sumber.

Rekomendasi, pilihan kandidat, opsi akhir, jumlah percobaan, fallback dan kualitas dikirim dalam metadata `auto`. Progres UI tidak mundur. Pembatalan tetap memakai penghentian worker dan generation guard, sehingga hasil dari pekerjaan lama tidak menggantikan gambar baru.

## Adaptasi dan batas kesetaraan

Ini merupakan port mekanisme kualitas ke pipeline desktop, bukan salinan penuh engine Android atau klaim SVG identik.

- Ketika smooth aktif dan masker detail tidak kosong, engine membandingkan tracing standar dengan tracing protected, termasuk saat cleanup mati. Kandidat protected dibatasi pertumbuhan path/segmen, error global maksimum 100,5% baseline, dan gerbang scene. Dua adaptasi desktop tetap dipertahankan: pemulihan protected saat cleanup menghapus semua foreground sebelum SVG baseline tersedia, dan perlindungan pasangan detail pada mode polygon tanpa smooth. Java memakai lintasan standard pada mode tanpa smooth.
- Objective coverage dibuat sebelum optimasi kontur dan dipakai kembali untuk evaluasi kurva akhir, sehingga perubahan coverage tidak dihitung dua kali.
- Kandidat kurva harus memiliki skor lebih baik, error maksimal 102% baseline + epsilon, dan tidak menyilang dirinya sendiri. Loop elips harus memenuhi dukungan geometris sebelum diuji terhadap raster.
- Pemeriksaan kurva dilewati untuk rantai di atas 6.000 titik atau 24.000 piksel boundary. Batas raster desktop menjadi 2048 × 2048 piksel; batas edge tetap 250.000.
- Penghapusan putih pada desktop dan Java memakai masker ekspor setelah fitting. Label putih tetap menyediakan bukti untuk batas bersama dan optimasi coverage.
- Evaluasi scene berjalan pada SVG aktual setelah fitting dan pembulatan koordinat ekspor, untuk Auto maupun Manual. Perubahan global dibatasi error global/detail maksimum 101%, error tepi 102%, dan setiap tile 103% + 0,002 terhadap baseline. Perbaikan rata-rata tidak dapat menutupi kerusakan detail kecil.
- `StrokeRegularizer` mengusulkan maksimum tiga perubahan: fairing kontur, kemudian balancing kurvatur dengan kekuatan 0,5 dan 0,15. Sudut dan endpoint tetap dijaga, pasangan sisi garis mempertahankan lebar lokal, deviasi geometris diperiksa dua arah maksimum 0,3 px, dan persilangan ditolak. Rantai bersama diekspor ulang dari satu geometri agar kedua region tetap menggunakan batas yang sama. Penjagaan deviasi memakai grid segmen lokal untuk membatasi biaya tanpa melonggarkan ambang jarak.
- Regularisasi dibatasi rantai 5–256 kurva, kurva maksimum panjang 2000 px, dan kontur sekitar 4000 sampel. Proposal yang tidak lolos mempertahankan baseline. Batch desktop memakai IndexedDB dan ZIP store; Android memakai file cache/index dan ZIP terkompresi. Tidak ada klaim kesetaraan byte hasil atau persistensi.
- Rekomendasi untuk input transparan penuh ditolak dengan pesan yang jelas; Java detektor sendiri mengembalikan rekomendasi default, sebelum tracing kemudian menolak sumber transparan.
- Jarak Oklab hanya digunakan untuk keputusan warna. Estimasi campuran antialias, dukungan piksel sumber, dan residual raster tetap dihitung dalam RGB/RGBA seperti sumber Java.

## Verifikasi

`npm run compile`, `npm run test:frontend`, dan `npm run build` memeriksa tipe, regresi dan bundling worker. Pengujian baru meliputi nilai Oklab primer, white background dibanding white artwork tertutup, kompatibilitas removeWhite, pasangan detail dibanding speck tunggal, elips rotasi dibanding persegi, dan batas error evaluasi cubic. Pengujian lama meliputi topologi diagonal, lubang, transparansi bersarang, antialias, sudut tajam, garis lurus, serta kernel riset.

Pengujian Auto mencakup deteksi foto/grain/tinta/latar putih, resampling alpha, SVG scene dengan lubang dan layering, pemilihan kandidat, override hasil preview pada resolusi akhir, retry, fallback bertingkat, kegagalan seluruh preview, refit detail dan gerbang tile, propagasi pembatalan, serta komunikasi worker Auto/Manual. Pengujian scene/stroke mencakup kerusakan detail tersembunyi oleh error global, penjagaan anchor/sudut, pasangan lebar garis, persilangan, deviasi terhadap pengukuran independen, diagnostik SVG aktual, serta penerimaan/penolakan regularisasi pada tracing produksi.

Regresi UI menjalankan handler DOM produksi melalui Happy DOM, IndexedDB pengujian, dan worker produksi; decode gambar, canvas serta API Tauri disimulasikan. Pemeriksaan mencakup upload satu/beberapa gambar ke daftar, klik baris menuju editor, kembali ke daftar, pengaturan masing-masing item, Auto ke Manual memakai opsi Auto miliknya, invalidasi hasil saat mode berubah, tracing item terpilih, ekspor SVG, serta pemulihan daftar dan pengaturan setelah inisialisasi ulang halaman. Pengujian deteksi memeriksa rekomendasi awal tanpa SVG/progres tracing, ukuran sumber asli, snapshot terisolasi dan fallback untuk nilai tersimpan tidak valid. Pengujian batch mencakup proses berurutan, kegagalan terisolasi, pembatalan/hasil terlambat, retry/resume, validasi input atomik, start ganda, pemulihan bytes/status/config/autoSettings/hasil, worker produksi Auto/Manual, dimensi ekspor, dan ZIP yang dibaca oleh reader platform independen. Pengujian Rust mencakup CRC/offset ZIP, nama tidak aman/duplikat, batas jumlah dan SVG aktif. Total terbaru 125 tes frontend dan 31 tes Rust lulus; compile dan build produksi juga lulus. Browser runtime tidak memiliki koneksi tersedia pada sesi ini sehingga tampilan visual live dan persistensi pada WebView desktop yang ditutup/dibuka kembali belum diverifikasi langsung.

`RND/star-quality/auto-audit.mjs` menjalankan gambar asli pengguna dan menyimpan SVG serta metadata kualitas. Audit bintang terdahulu, sebelum pemeriksaan ulang pipeline, pada 1024 × 765 dan 2048 × 1529 memilih dua warna, toleransi 0,2, minArea 12, background white removal, dan selesai tanpa fallback. Kedua audit menolak tiga proposal global yang melanggar gerbang scene; empat ujung bintang tetap terjaga. Audit 2048 menghasilkan 85 path dan 2849 segmen, error global 0,00026726, sekitar 10 detik pada mesin sesi ini. Kinerja bergantung gambar/perangkat dan tidak dibandingkan langsung dengan Android. Pratinjau crop dibentuk secara independen dari SVG; resampling System.Drawing berbeda dari canvas browser.

Verifikasi ini tidak mencakup perbandingan visual pada seluruh korpus foto Android atau pengukuran kinerja pada semua ukuran gambar. Browser runtime tidak memiliki koneksi tersedia pada sesi implementasi Auto, sehingga UI live belum diverifikasi secara visual; worker nyata diuji melalui worker_threads dan build produksi memverifikasi bundling.
