import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] || 'license-keys');
mkdirSync(output, { recursive: true, mode: 0o700 });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
writeFileSync(resolve(output, 'public.pem'), publicPem, { mode: 0o644 });
writeFileSync(resolve(output, 'private.pem'), privatePem, { mode: 0o600 });
const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
console.log(`Keypair dibuat di ${output}. Private key jangan di-commit.`);
console.log(`LICENSE_PUBLIC_KEY=${rawPublicKey}`);
