import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2).reduce((all, arg, index, values) => {
  if (!arg.startsWith('--')) return all;
  all[arg.slice(2)] = values[index + 1]; return all;
}, {});
if (!args.email || !args.days || !args['private-key']) throw new Error('Usage: npm run license:create -- --email customer@example.com --days 30 --private-key ./license-keys/private.pem');
const email = args.email.trim().toLowerCase(); const days = Number(args.days); if (!Number.isFinite(days) || days <= 0) throw new Error('--days harus positif');
const issued = new Date(); const expires = new Date(issued.getTime() + days * 86_400_000);
const payload = { product: 'canvas-vector-recorder', email, license_id: randomUUID(), issued_at: issued.toISOString(), expires_at: expires.toISOString(), max_devices: Number(args['max-devices'] || 1) };
const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
const privateKey = createPrivateKey(readFileSync(args['private-key'])); const signature = sign(null, Buffer.from(payloadPart), privateKey).toString('base64url');
console.log(`CVR1.${payloadPart}.${signature}`);
