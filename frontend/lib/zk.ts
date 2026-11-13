/**
 * Zero-knowledge helpers shared by the prover (record owner) and the verifier.
 *
 * The circuit proves, for a private (vaccinationCount, salt):
 *   commitment = Poseidon(vaccinationCount, salt)
 *   valid      = 1 iff vaccinationCount >= threshold
 * and binds the proof to a verifier-chosen challenge.
 *
 * Public signals, in order: valid, commitment, threshold, challenge.
 *
 * Everything here runs on the owner's or verifier's own machine. No function
 * in this file sends the count or the salt anywhere.
 */
import { poseidon2 } from "poseidon-lite";

/** Largest count the 32-bit circuit accepts. */
export const MAX_COUNT = 2 ** 32 - 1;

/** Where the browser loads the circuit artifacts from. */
export const DEFAULT_ARTIFACTS = {
  wasm: "/zk/vaccination_threshold.wasm",
  zkey: "/zk/circuit_final.zkey",
  vkey: "/zk/verification_key.json",
};

export const SIGNAL = { valid: 0, commitment: 1, threshold: 2, challenge: 3 } as const;

export type Groth16Proof = unknown;

export type DisclosureProof = {
  proof: Groth16Proof;
  publicSignals: string[];
};

/** What a record owner hands to a verifier. Contains no private value. */
export type DisclosurePackage = DisclosureProof & {
  /** Address of the on-chain record account the proof refers to. */
  record: string;
};

export type DisclosureCheck = { ok: true } | { ok: false; reason: string };

/**
 * 31 random bytes as an integer. 248 bits is always below the BN254 scalar
 * field modulus (about 2^254), so the value never wraps inside the circuit.
 */
export function randomFieldElement(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Accepts a number or a digit string; rejects anything the circuit cannot represent. */
export function parseCount(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    n = Number(value.trim());
  } else {
    throw new Error("Vaccination count must be a whole number.");
  }
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Vaccination count must be a whole number, zero or more.");
  }
  if (n > MAX_COUNT) {
    throw new Error(`Vaccination count must be at most ${MAX_COUNT}.`);
  }
  return n;
}

/** Decimal-string field element (as stored in a record or typed by a verifier) to bigint. */
export function parseFieldElement(value: unknown, name: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error(`${name} must be a non-negative whole number written in digits.`);
}

export function computeCommitment(count: number, salt: bigint): bigint {
  return poseidon2([BigInt(parseCount(count)), salt]);
}

/** 32 bytes, big-endian: the form stored in the on-chain record account. */
export function commitmentToBytes(commitment: bigint): Uint8Array {
  if (commitment < 0n || commitment >= 1n << 256n) {
    throw new Error("Commitment does not fit in 32 bytes.");
  }
  const out = new Uint8Array(32);
  let v = commitment;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function bytesToCommitment(bytes: ArrayLike<number>): bigint {
  if (bytes.length !== 32) throw new Error("Commitment must be 32 bytes.");
  let n = 0n;
  for (let i = 0; i < 32; i++) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
}

/**
 * Generates the proof locally. `salt` is the value stored inside the
 * encrypted record; a record created before commitments existed has none,
 * and no meaningful proof can be made for it.
 */
export async function proveThreshold(
  input: {
    vaccinationCount: unknown;
    salt: bigint | undefined;
    threshold: number;
    challenge: bigint;
  },
  artifacts: { wasm: string; zkey: string } = DEFAULT_ARTIFACTS
): Promise<DisclosureProof> {
  if (input.salt === undefined) {
    throw new Error(
      "This record has no salt, so it cannot be tied to an on-chain commitment. Upload the record again."
    );
  }
  const count = parseCount(input.vaccinationCount);
  const threshold = parseCount(input.threshold);
  const snarkjs = await import("snarkjs");
  return snarkjs.groth16.fullProve(
    {
      vaccinationCount: count.toString(),
      salt: input.salt.toString(),
      threshold: threshold.toString(),
      challenge: input.challenge.toString(),
    },
    artifacts.wasm,
    artifacts.zkey
  );
}

/**
 * The verifier's whole decision. `expected` holds values the verifier
 * obtained independently: the commitment read from the chain, and the
 * threshold and challenge the verifier chose. A proof is accepted only if it
 * is cryptographically valid AND speaks about exactly those values.
 */
export async function checkDisclosure(args: {
  vkey: unknown;
  proof: Groth16Proof;
  publicSignals: string[];
  expected: { commitment: bigint; threshold: number; challenge: bigint };
}): Promise<DisclosureCheck> {
  const { vkey, proof, publicSignals, expected } = args;
  if (!Array.isArray(publicSignals) || publicSignals.length !== 4) {
    return { ok: false, reason: "malformed public signals" };
  }
  let signals: bigint[];
  try {
    signals = publicSignals.map((s) => BigInt(s));
  } catch {
    return { ok: false, reason: "malformed public signals" };
  }
  if (signals[SIGNAL.commitment] !== expected.commitment) {
    return { ok: false, reason: "commitment mismatch" };
  }
  if (signals[SIGNAL.threshold] !== BigInt(expected.threshold)) {
    return { ok: false, reason: "threshold mismatch" };
  }
  if (signals[SIGNAL.challenge] !== expected.challenge) {
    return { ok: false, reason: "challenge mismatch" };
  }
  const snarkjs = await import("snarkjs");
  let verified = false;
  try {
    verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, reason: "invalid proof" };
  if (signals[SIGNAL.valid] !== 1n) {
    return { ok: false, reason: "claim not satisfied" };
  }
  return { ok: true };
}
