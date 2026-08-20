# Canvas Vector Recorder Desktop

Aplikasi ini adalah project Tauri v2 terpisah dari extension WXT di `../canvas-vector-recorder`. Project sumber tidak diubah dan tetap menjadi extension browser. Studio desktop menggunakan frontend TypeScript untuk activation/workspace, target WebView untuk menjalankan halaman asli, dan Rust untuk recorder state, Path2D, transform, validasi microstock, XML escaping, generator SVG, storage, serta lisensi.

## Arsitektur

Studio window memiliki UI lisensi dan workspace. `open_target_url` membuat target WebView dengan initialization script pada document start di semua frame; event memiliki `frame_id` dan sequence per frame agar iframe tidak saling menolak. `src/recorder-bridge.js` hanya mendeteksi elemen Canvas (termasuk WebGL), `OffscreenCanvas`, dan operasi Canvas 2D; batching maksimum 100 event atau 150 ms, dan memanggil satu command recorder. Daftar asset dikirim kembali ke studio setiap batch diterima. Session token dibuat Rust dan disuntikkan ke setiap navigasi; command recorder menolak token, sequence, tipe event, ukuran payload, dan batas memory yang tidak valid. Capability target hanya berisi `record_canvas_events`; command lisensi, storage, dan export hanya ada pada capability studio.

Generator di Rust mengeluarkan SVG standalone dengan namespace, artboard rasio/microstock, path fill/stroke, transform, dan XML escaping. Bridge tidak berisi algoritma SVG atau lisensi.

## Prasyarat dan development

Install Node.js 20+ dan Rust stable/Cargo, lalu:

```sh
npm install
npm run tauri:dev
```

`npm run compile` memeriksa TypeScript. `npm run test` menjalankan compile frontend lalu `cargo test --manifest-path src-tauri/Cargo.toml`. Build installer lintas platform memakai `npm run tauri:build`; Tauri hanya menghasilkan target untuk environment/toolchain yang tersedia.

Environment dibaca pada saat build Rust. Salin `.env.example` menjadi `.env`; build Rust dan generator lisensi akan membacanya otomatis, sementara environment shell memiliki prioritas lebih tinggi. Jangan commit `.env` atau key. `LICENSE_PRODUCT_CODE` wajib diisi dan harus sama saat membuat token maupun build aplikasi, misalnya `LICENSE_PRODUCT_CODE=canvas-vector-recorder`.

Saat startup, aplikasi menampilkan landing screen selama 2 detik sebelum memeriksa lisensi dan membuka activation screen atau workspace. UI menggunakan Plus Jakarta Sans variable font yang dibundel lokal di `src/assets/fonts`, sehingga tidak membutuhkan koneksi internet untuk memuat font.

## Tauri updater

Updater memakai key pair terpisah dari key lisensi Guardian. Public key updater
disimpan di `src-tauri/tauri.conf.json`, sedangkan private key tidak boleh masuk
repository. Untuk publish release, tambahkan GitHub Actions secrets berikut:

- `TAURI_SIGNING_PRIVATE_KEY`: isi private key updater dari Bitwarden.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password private key updater.
- `LICENSE_PUBLIC_KEY`: public key lisensi yang dipakai saat build.

Workflow `.github/workflows/publish-desktop.yml` berjalan melalui `workflow_dispatch`
atau push ke branch `release`. Workflow membuat artifact updater bertanda tangan
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
