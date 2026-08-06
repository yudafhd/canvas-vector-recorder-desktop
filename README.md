# Canvas Vector Recorder Desktop

Aplikasi ini adalah project Tauri v2 terpisah dari extension WXT di `../canvas-vector-recorder`. Project sumber tidak diubah dan tetap menjadi extension browser. Studio desktop menggunakan frontend TypeScript untuk activation/workspace, target WebView untuk menjalankan halaman asli, dan Rust untuk recorder state, Path2D, transform, validasi microstock, XML escaping, generator SVG, storage, serta lisensi.

## Arsitektur

Studio window memiliki UI lisensi dan workspace. `open_target_url` membuat target WebView dengan initialization script pada document start di semua frame; event memiliki `frame_id` dan sequence per frame agar iframe tidak saling menolak. `src/recorder-bridge.js` mendeteksi elemen Canvas (termasuk WebGL), `OffscreenCanvas`, operasi Canvas 2D, SVG inline, serta SVG eksternal same-origin pada `img/object/embed`; batching maksimum 100 event atau 75 ms, dan memanggil satu command recorder. Daftar asset dikirim kembali ke studio setiap batch diterima. Session token dibuat Rust dan disuntikkan ke setiap navigasi; command recorder menolak token, sequence, tipe event, ukuran payload, dan batas memory yang tidak valid. Capability target hanya berisi `record_canvas_events`; command lisensi, storage, dan export hanya ada pada capability studio.

Generator di Rust mengeluarkan SVG standalone dengan namespace, artboard rasio/microstock, path fill/stroke, transform, dan XML escaping. Bridge tidak berisi algoritma SVG atau lisensi.

## Prasyarat dan development

Install Node.js 20+ dan Rust stable/Cargo, lalu:

```sh
npm install
npm run tauri:dev
```

`npm run compile` memeriksa TypeScript. `npm run test` menjalankan compile frontend lalu `cargo test --manifest-path src-tauri/Cargo.toml`. Build installer lintas platform memakai `npm run tauri:build`; Tauri hanya menghasilkan target untuk environment/toolchain yang tersedia.

Environment dibaca pada saat build Rust. Salin `.env.example` menjadi `.env` untuk dokumentasi lokal, lalu export variabelnya sebelum `npm run tauri:build`; jangan commit `.env` atau key.

## Lisensi

Buat keypair offline di mesin pemilik/license server:

```sh
npm run license:keygen
npm run license:create -- --email customer@example.com --days 2 --private-key ./license-keys/private.pem
```

Tool menandatangani tepat payload-base64url yang diverifikasi Rust: `CVR1.<payload-base64url>.<signature-base64url>`. Untuk flow offline dua hari, buat kode dengan `--days 2`. Private key hanya berada di license server/offline operator. `license:keygen` mencetak nilai `LICENSE_PUBLIC_KEY=...`; gunakan nilai 32-byte Ed25519 base64url itu saat build. Release tanpa public key akan menolak lisensi, bukan bypass menjadi valid.

Activation default sepenuhnya offline: Rust memverifikasi signature Ed25519, email, product, issued/expiry date, lalu menyimpan status lokal. `expires_at` adalah batas waktu kode untuk aktivasi; setelah aktivasi offline berhasil, entitlement menjadi lifetime pada perangkat yang sama. Device fingerprint berbasis identitas instalasi/hardware OS dibandingkan setiap aplikasi dibuka. Aplikasi mencoba OS keyring melalui crate `keyring`; bila backend keyring tidak tersedia, fallback menyimpan file app-data dengan permission `0600`. Fallback melindungi akses filesystem biasa tetapi tidak setara keyring/Stronghold, sehingga deployment produksi sebaiknya memastikan backend secure storage tersedia. Perubahan waktu mundur ditolak semampunya.

`license-server/server.mjs` adalah mock development in-memory dan tidak diperlukan untuk mode offline. Jika ingin mengaktifkan validasi online opsional, set `LICENSE_OFFLINE_ONLY=false` dan `LICENSE_SERVER_URL`; server production harus memverifikasi signature, revocation, max devices, audit, rate limit, TLS, dan penyimpanan durable. Mode offline tidak dapat mencabut lisensi dari jarak jauh atau membatasi satu lisensi ke satu perangkat secara terpusat.

## Testing dan fixture

`tests/fixtures/canvas-test.html` membuat canvas, Path2D, `drawImage`, `clip`, fill, stroke, dan transform. Unit test Rust mencakup parsing/sequence di recorder, path/transform/SVG escaping/microstock, serta validasi signature, email, product, payload modification, waktu issued/expiry. Tambahkan test browser untuk bridge batching, flush, stop, reinjection setelah navigation, dan error IPC menggunakan WebView automation di CI.

## Keterbatasan keamanan dan kompatibilitas

Desktop distribution tidak dapat dibuat mustahil dibajak; pemindahan core ke Rust dan signature license hanya memperberat reverse engineering serta mengurangi license sharing. Obfuscation bridge hanyalah lapisan tambahan. Jangan memasukkan private key, API secret, production token, activation token, source map installer, atau dev bypass ke release.

Halaman target dengan CSP ketat, sandbox, browser-internal URL, atau implementasi Canvas non-standar dapat menolak initialization script atau membatasi IPC. Iframe same-origin dapat diproses saat script berjalan dalam frame yang sesuai; Canvas pada iframe cross-origin tidak dapat di-hook tanpa izin tambahan dan tidak boleh dilewati dengan melemahkan kebijakan keamanan. Capability remote URL saat ini mencakup HTTP(S), tetapi command yang diizinkan tetap hanya batch recorder; untuk deployment yang lebih ketat, sempitkan daftar domain target pada capability yang dibuat per produk.
