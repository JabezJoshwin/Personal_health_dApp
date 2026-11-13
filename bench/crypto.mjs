// Client-side encryption benchmark. Uses the application's own
// encryptJson/decryptJson (PBKDF2-SHA256, 120,000 iterations, AES-256-GCM)
// so the numbers describe the shipped code path.
//
// Usage: node bench/crypto.mjs [runs]   (default 30)
import { decryptJson, encryptJson } from "../frontend/lib/crypto.ts";
import { timeIt, writeResult } from "./stats.mjs";

const RUNS = Number(process.argv[2] ?? 30);
const PASSPHRASE = "benchmark-passphrase";

const sample = {
  name: "Alex Student",
  age: 21,
  bloodGroup: "O+",
  vaccinationCount: 3,
  vaccines: ["Influenza 2025", "Tdap", "COVID-19 booster"],
  testReports: ["CBC — normal", "Lipid panel — pending"],
  zkSalt: "123456789012345678901234567890",
};

/** The sample record padded with free-text notes up to about `bytes` of JSON. */
function recordOfSize(bytes) {
  const base = Buffer.byteLength(JSON.stringify({ ...sample, notes: "" }));
  return { ...sample, notes: "x".repeat(Math.max(0, bytes - base)) };
}

async function pbkdf2Only() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PASSPHRASE),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

const key_derivation = await timeIt(pbkdf2Only, { n: RUNS });

const cases = [
  { label: "sample record", record: sample },
  { label: "1 KiB", record: recordOfSize(1024) },
  { label: "16 KiB", record: recordOfSize(16 * 1024) },
  { label: "64 KiB", record: recordOfSize(64 * 1024) },
  { label: "256 KiB", record: recordOfSize(256 * 1024) },
];

const payloads = [];
for (const c of cases) {
  const plaintext_bytes = Buffer.byteLength(JSON.stringify(c.record));
  const encrypted = await encryptJson(c.record, PASSPHRASE);
  const stored_bytes = Buffer.byteLength(JSON.stringify(encrypted));
  const encrypt = await timeIt(() => encryptJson(c.record, PASSPHRASE), { n: RUNS });
  const decrypt = await timeIt(() => decryptJson(encrypted, PASSPHRASE), { n: RUNS });
  payloads.push({ label: c.label, plaintext_bytes, stored_bytes, encrypt, decrypt });
}

writeResult("crypto.json", {
  recorded_at: new Date().toISOString(),
  runs: RUNS,
  warmup_runs: 5,
  parameters: { kdf: "PBKDF2-HMAC-SHA256", iterations: 120000, salt_bytes: 16, cipher: "AES-256-GCM", iv_bytes: 12 },
  note: "encrypt and decrypt each include one key derivation, as in the application. stored_bytes is the JSON object pinned to IPFS (base64 ciphertext plus salt, IV and labels). Measured with Web Crypto in Node.js.",
  key_derivation,
  payloads,
});
