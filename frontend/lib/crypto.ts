import type { EncryptedPayload } from "./encryptedPayload";

/** Narrow DOM `Uint8Array` typing for Web Crypto (TS 5 + lib.dom). */
function asBufferSource(data: Uint8Array): BufferSource {
  return data as unknown as BufferSource;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passRaw = enc.encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passRaw.buffer.slice(
      passRaw.byteOffset,
      passRaw.byteOffset + passRaw.byteLength
    ) as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: 120_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

export async function encryptJson(
  value: unknown,
  passphrase: string
): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(passphrase, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(plaintext)
  );
  return {
    v: 1,
    alg: "AES-GCM-256",
    kdf: "PBKDF2-SHA256",
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
  };
}

export async function decryptJson(
  payload: EncryptedPayload,
  passphrase: string
): Promise<unknown> {
  const salt = b64ToBytes(payload.salt);
  const iv = b64ToBytes(payload.iv);
  const ciphertext = b64ToBytes(payload.ciphertext);
  const key = await deriveAesGcmKey(passphrase, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(ciphertext)
  );
  const text = new TextDecoder().decode(new Uint8Array(plaintext));
  return JSON.parse(text) as unknown;
}
