# Panduan Rilis

Dokumen ini menjelaskan cara menerbitkan rilis desktop Canvas Vector Recorder melalui GitHub Actions.

## Hasil rilis

Workflow **Build & publish desktop release** membuat GitHub Release berisi:

- Installer Windows x64 dalam format NSIS (`.exe`).
- Bundle macOS Intel dalam format `.dmg` dan `.app`.

Workflow ini menargetkan `x86_64-apple-darwin` pada runner macOS dan `windows-latest` untuk Windows. Rilis juga menyiapkan metadata dan signature update bertanda tangan yang digunakan oleh fitur auto-update desktop aplikasi (`latest.json`).

## Prasyarat satu kali

Pastikan repository GitHub memiliki secrets berikut sebelum menjalankan rilis:

- `LICENSE_PUBLIC_KEY`: Kunci publik lisensi raw base64url, tepat 32 byte (43 karakter tanpa padding). Workflow memvalidasi format dan panjangnya secara otomatis.
- `TAURI_SIGNING_PRIVATE_KEY`: Private key updater Tauri untuk menandatangani artefak update.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password private key updater (kosongkan jika key tidak menggunakan password).

Public key updater sudah tersimpan di `src-tauri/tauri.conf.json`. Simpan private key dengan aman dan jangan pernah commit private key atau folder keys ke repository.

## Persiapan setiap rilis

1. Perbarui nomor versi ke nilai yang sama di 3 file:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Pastikan perubahan rilis sudah masuk ke commit/branch yang akan dirilis.
3. Jalankan pengujian lokal:
   ```bash
   npm test
   ```
   Pengujian ini menjalankan typecheck frontend (`tsc --noEmit`), test frontend (`node --test tests/bridge.test.mjs`), dan test Rust (`cargo test`).

Workflow GitHub Actions akan memverifikasi konsistensi ketiga nomor versi tersebut. Untuk pemicu dengan tag, nama tag wajib berformat `v<versi>` (misalnya versi `1.1.8` harus menggunakan tag `v1.1.8`).

## Menjalankan rilis

Pilih salah satu dari dua cara berikut:

### 1. Dengan Git Tag (Direkomendasikan)

Push tag versi ke GitHub:

```bash
git tag v1.1.8
git push origin v1.1.8
```

Ganti `1.1.8` dengan nomor versi yang telah diselaraskan di ketiga file versi di atas.

### 2. Secara Manual (Workflow Dispatch)

1. Buka repository GitHub di browser, lalu klik tab **Actions**.
2. Pilih workflow **Build & publish desktop release**.
3. Klik tombol **Run workflow**, pilih branch `master`, lalu jalankan.

Pada pemicu manual, workflow akan membaca nomor versi dari file proyek dan membuat/memperbarui release dengan tag `v<versi>`.

## Memeriksa hasil

1. Tunggu kedua job matrix (`macOS Intel` dan `Windows x64`) selesai dengan status sukses hijau.
2. Buka halaman **Releases** di GitHub repository.
3. Pastikan installer Windows NSIS (`.exe`), bundle macOS (`.dmg`), serta file signature `.sig` dan `latest.json` tersedia.

## Workflow CI

Workflow **Continuous integration** (`ci.yml`) berjalan otomatis pada setiap pull request dan push ke branch `master`. Workflow tersebut menguji typecheck frontend dan test Rust. CI tidak menerbitkan release dan tidak menghasilkan installer aplikasi.
