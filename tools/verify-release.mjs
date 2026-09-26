import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargoToml = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

const packageVersion = packageJson.version;
const tauriVersion = tauriConfig.version;
const cargoVersion = cargoMatch ? cargoMatch[1] : null;

console.log(`package.json:        ${packageVersion}`);
console.log(`tauri.conf.json:     ${tauriVersion}`);
console.log(`Cargo.toml:          ${cargoVersion}`);

if (!cargoVersion || new Set([packageVersion, tauriVersion, cargoVersion]).size !== 1) {
  console.error('ERROR: Version mismatch detected!');
  process.exit(1);
}

console.log(`SUCCESS: All versions match: v${packageVersion}`);
