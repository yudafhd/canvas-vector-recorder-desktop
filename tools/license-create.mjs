import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readDotEnvValue(name) {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(envPath)) return undefined;
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.trim().replace(/^export\s+/, '').startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.replace(/^\s*(?:export\s+)?[^=]+=/, '').trim();
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

const args = process.argv.slice(2).reduce((all, arg, index, values) => {
  if (!arg.startsWith('--')) return all;
  all[arg.slice(2)] = values[index + 1]; return all;
}, {});
if (!args.email || !args['private-key']) throw new Error('Usage: npm run license:create -- --email customer@example.com --days 2 --perpetual --private-key ./license-keys/private.pem');
const product = (process.env.LICENSE_PRODUCT_CODE ?? readDotEnvValue('LICENSE_PRODUCT_CODE'))?.trim();
if (!product) throw new Error('LICENSE_PRODUCT_CODE wajib diisi di environment');
if (!/^[A-Za-z0-9_-]+$/.test(product)) throw new Error('LICENSE_PRODUCT_CODE hanya boleh berisi huruf, angka, tanda minus, atau underscore');
const email = args.email.trim().toLowerCase(); const activationDays = Number(args.days || args['activation-days'] || 2);
if (!Number.isInteger(activationDays) || activationDays <= 0) throw new Error('--days harus berupa bilangan bulat positif');
const durationDays = args['duration-days'] === undefined
  ? (args.years === undefined ? undefined : Number(args.years) * 365)
  : Number(args['duration-days']);
const perpetual = args.perpetual !== undefined;
if (perpetual && durationDays !== undefined) throw new Error('--perpetual tidak boleh digabung dengan --duration-days atau --years');
if (!perpetual && (!Number.isInteger(durationDays) || durationDays <= 0)) throw new Error('Pilih --perpetual atau isi --duration-days/--years dengan bilangan bulat positif');
const issued = new Date();
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const issuedInWib = new Date(issued.getTime() + WIB_OFFSET_MS);
const issuedDayStartUtc = Date.UTC(issuedInWib.getUTCFullYear(), issuedInWib.getUTCMonth(), issuedInWib.getUTCDate()) - WIB_OFFSET_MS;
const activationExpires = new Date(issuedDayStartUtc + (activationDays + 1) * 86_400_000);
const payload = {
  schema: 2,
  product,
  email,
  license_id: randomUUID(),
  issued_at: issued.toISOString(),
  activation_expires_at: activationExpires.toISOString(),
  duration_days: perpetual ? null : durationDays,
  max_devices: Number(args['max-devices'] || 1),
  features: {},
};
if (!Number.isInteger(payload.max_devices) || payload.max_devices <= 0) throw new Error('--max-devices harus berupa bilangan bulat positif');
const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
const privateKey = createPrivateKey(readFileSync(args['private-key'])); const signature = sign(null, Buffer.from(payloadPart), privateKey).toString('base64url');
console.log(`${payload.product}.${payloadPart}.${signature}`);
