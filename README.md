# Canvas Vector Recorder Desktop

Aplikasi ini adalah project Tauri v2 terpisah dari extension WXT di `../canvas-vector-recorder`. Project sumber tidak diubah dan tetap menjadi extension browser. Studio desktop menggunakan frontend TypeScript untuk activation/workspace, target WebView untuk menjalankan halaman asli, dan Rust untuk recorder state, Path2D, transform, validasi microstock, XML escaping, generator SVG, storage, serta lisensi.

## Arsitektur

Studio window memiliki UI lisensi dan workspace. `open_target_url` membuat target WebView dengan initialization script pada document start di semua frame; event memiliki `frame_id` dan sequence per frame agar iframe tidak saling menolak. `src/recorder-bridge.js` mendeteksi elemen Canvas (termasuk WebGL), `OffscreenCanvas`, operasi Canvas 2D, dan SVG bermakna yang sudah terisi elemen grafis. Canvas direkonstruksi menjadi SVG baru, sedangkan SVG DOM disimpan sebagai artwork sumber pada tab SVG dan dibungkus dalam artboard saat preview/export agar mengikuti Export Settings. Daftar asset dikirim kembali ke studio saat berubah. Session token dibuat Rust dan disuntikkan ke setiap navigasi; command recorder menolak token, sequence, tipe event, ukuran payload, dan batas memory yang tidak valid. Capability target hanya berisi command perekaman; command lisensi, storage, dan export hanya ada pada capability studio.

Generator di Rust mengeluarkan SVG standalone dengan namespace, artboard rasio/microstock, path fill/stroke, transform, dan XML escaping. Bridge tidak berisi algoritma SVG atau lisensi.

## Halaman Tracing

**Pengaturan ekspor global** di Offline mengatur rasio artboard (termasuk custom), Min/Max MP, skala artwork, dan hapus atau pertahankan latar putih. Pengaturan tersimpan dan berlaku untuk SVG/EPS satu item serta ZIP batch. Ekspor desktop memakai pembentuk SVG/EPS Online yang sama, dengan artwork dipusatkan dan margin 10%. Hapus latar putih hanya membuang putih yang terhubung ke tepi gambar; detail putih di dalam artwork dipertahankan. Bila pilihan latar berbeda dari hasil tracing, ekspor memproses ulang gambar dengan pilihan tersebut. Batas artboard 15–65 MP dan file 45 MB tetap diperiksa. Ekstrak ZIP sebelum mengunggah ke Adobe Stock.

Menu awal menyediakan **Tracing online** untuk membuka Recorder Canvas/SVG dari situs dan **Tracing offline** untuk mengubah PNG/JPG/WebP lokal menjadi SVG. Offline dimulai dari daftar gambar; buka item untuk melihat editor dengan mode Auto atau Manual dan pengaturan per gambar. Pratinjau asli/vektor mendukung zoom dan panel pengaturan dapat ditutup. **Simpan SVG** mengekspor hasil satu item; **Ekspor ZIP** menyimpan hasil antrean. Tombol **Menu** kembali ke pilihan mode tanpa menghapus antrean, pengaturan, atau hasil. Mengubah pengaturan menandai hasil lama tidak berlaku; proses bisa dibatalkan.

Menu dan tracing offline memakai warna serta layout yang terinspirasi Material 3, tema terang/gelap, indikator fokus keyboard, dan animasi singkat yang mengikuti `prefers-reduced-motion`.

Daftar gambar menampilkan thumbnail sumber (maks. 384 px) dan hasil SVG, status per item, palet, serta ukuran hasil. Pilih tampilan daftar/kartu, cari nama file, atau filter status. Pilihan tampilan tersimpan di perangkat; pencarian dan filter hanya mengubah gambar yang ditampilkan. Thumbnail dibuat berurutan dan URL pratinjau dilepas ketika item atau hasilnya dihapus.

Mesin mandiri di `src/tracing/engine.ts` berjalan dalam Web Worker: pengelompokan warna, pembersihan region kecil, penelusuran batas bersama, lalu penyederhanaan garis/fitting Bézier. Batas yang sama hanya difit sekali dan dipakai kedua bidang dengan arah berlawanan. Ini implementasi awal yang diinformasikan riset; belum merupakan reproduksi mesin Vector Magic atau keputusan merge/swap-nya. Detail implementasi dan pengujian ada di [catatan tracing](docs/TRACING.md).

## Prasyarat dan development

Install Node.js 20+ dan Rust stable/Cargo, lalu:

```sh
npm install
npm run tauri:dev
```

`npm run compile` memeriksa TypeScript. `npm run test` menjalankan compile frontend lalu `cargo test --manifest-path src-tauri/Cargo.toml`. Build installer lintas platform memakai `npm run tauri:build`; Tauri hanya menghasilkan target untuk environment/toolchain yang tersedia.

Environment lisensi dibaca pada saat build Rust. Salin `.env.example` menjadi `.env`; build Rust dan generator lisensi akan membacanya otomatis, sementara environment shell memiliki prioritas lebih tinggi. Jangan commit `.env` atau key. `LICENSE_PRODUCT_CODE` wajib diisi dan harus sama saat membuat token maupun build aplikasi. Versi aplikasi dikelola dari `package.json` dan konfigurasi Tauri, bukan dari `.env`.

Saat startup, aplikasi langsung memeriksa lisensi, lalu menampilkan aktivasi atau pilihan mode tracing. Tidak ada jeda splash tambahan atau kutipan motivasi saat startup. UI menggunakan Plus Jakarta Sans variable font yang dibundel lokal di `src/assets/fonts`, sehingga tidak membutuhkan koneksi internet untuk memuat font.

## Tauri updater

Updater memakai key pair terpisah dari key lisensi Guardian. Public key updater
disimpan di `src-tauri/tauri.conf.json`, sedangkan private key tidak boleh masuk
repository. Untuk publish release, tambahkan GitHub Actions secrets berikut:

- `TAURI_SIGNING_PRIVATE_KEY`: isi private key updater dari Bitwarden.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password private key updater.
- `LICENSE_PUBLIC_KEY`: public key lisensi yang dipakai saat build.

Untuk panduan lengkap langkah demi langkah pembuatan rilis, ikuti [panduan rilis](docs/RELEASING.md).
Workflow `.github/workflows/publish-desktop.yml` berjalan melalui `workflow_dispatch`
atau push tag versi `v*`. Workflow membuat artifact updater bertanda tangan
dan GitHub Release yang dibaca aplikasi melalui `latest.json`. Naikkan versi di
`package.json`, `src-tauri/Cargo.toml`, dan `src-tauri/tauri.conf.json` sebelum
mempublish update berikutnya.

## Lisensi

Buat keypair offline di mesin pemilik/license server:

```sh
npm run license:keygen
npm run license:create -- --email customer@example.com --days 2 --perpetual --private-key ./license-keys/private.pem
```

Flow lisensi menggunakan crate `guardian-core` dari GitHub. Untuk subscription, ganti `--perpetual` dengan `--duration-days 365` atau `--years 1`. Tool menandatangani token `<LICENSE_PRODUCT_CODE>.<payload-base64url>.<signature-base64url>`; prefix berasal dari `LICENSE_PRODUCT_CODE` dan ikut diverifikasi dari signed payload. Token lama dengan prefix `SLC1` tetap dapat diverifikasi untuk kompatibilitas. `--days` adalah activation window; durasi subscription dimulai saat aktivasi pertama, bukan saat token diterbitkan. Private key hanya berada di license server/offline operator. `license:keygen` mencetak nilai `LICENSE_PUBLIC_KEY=...`; gunakan nilai 32-byte Ed25519 base64url itu saat build. Release tanpa public key akan menolak aktivasi, bukan bypass menjadi valid.

Saat aktivasi, Guardian memverifikasi signature, schema, email, product, activation window, lalu menyimpan signed license code dan device binding ke `guardian-license.json` di app-data dengan permission `0600`. Pengecekan waktu aplikasi memakai endpoint HTTPS `time.now/developer/api/timezone/Asia/Jakarta` dan cache lima menit; endpoint ini mengembalikan waktu UTC tanpa API key. Jika endpoint tidak tersedia, aplikasi mempertahankan mode offline dengan cache atau waktu sistem dan tetap menerapkan pemeriksaan clock rollback. Setiap status check memverifikasi ulang token, menghitung ulang expiry dari payload, serta menolak device berbeda dan perubahan record lokal. Lifetime hanya dapat berasal dari payload bertanda tangan; tidak ada flag lokal yang dapat mengubah subscription menjadi lifetime. Command recorder, preview, dan export juga memanggil `require_valid` di Rust sehingga UI bukan satu-satunya enforcement point.

`license-server/server.mjs` tetap menjadi mock development terpisah. Aktivasi lisensi tetap dilakukan offline melalui `LicenseManager::activate`, sedangkan aplikasi mengambil UTC dari Time.now ketika tersedia. Pencegahan replay lintas perangkat, revocation, dan max-device global memerlukan `ActivationAuthority`/service atomik sesuai dokumentasi Guardian dan belum diaktifkan oleh aplikasi ini.

## Testing dan fixture

`tests/fixtures/canvas-test.html` membuat canvas, Path2D, `drawImage`, `clip`, fill, stroke, dan transform. Unit test Rust mencakup parsing/sequence di recorder, path/transform/SVG escaping/microstock, serta validasi signature, email, product, payload modification, waktu issued/expiry. Tambahkan test browser untuk bridge batching, flush, stop, reinjection setelah navigation, dan error IPC menggunakan WebView automation di CI.

## Keterbatasan keamanan dan kompatibilitas

Desktop distribution tidak dapat dibuat mustahil dibajak; pemindahan core ke Rust dan signature license hanya memperberat reverse engineering serta mengurangi license sharing. Obfuscation bridge hanyalah lapisan tambahan. Jangan memasukkan private key, API secret, production token, activation token, source map installer, atau dev bypass ke release.

Halaman target dengan CSP ketat, sandbox, browser-internal URL, atau implementasi Canvas non-standar dapat menolak initialization script atau membatasi IPC. Iframe same-origin dapat diproses saat script berjalan dalam frame yang sesuai; Canvas pada iframe cross-origin tidak dapat di-hook tanpa izin tambahan dan tidak boleh dilewati dengan melemahkan kebijakan keamanan. Capability remote URL saat ini mencakup HTTP(S), tetapi command yang diizinkan tetap hanya batch recorder; untuk deployment yang lebih ketat, sempitkan daftar domain target pada capability yang dibuat per produk.
