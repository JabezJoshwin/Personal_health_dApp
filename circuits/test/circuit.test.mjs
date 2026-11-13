import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { poseidon2 } from "poseidon-lite";

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(here, "..", "build");
const wasm = path.join(build, "vaccination_threshold_js", "vaccination_threshold.wasm");
const zkey = path.join(build, "circuit_final.zkey");
const vkey = JSON.parse(fs.readFileSync(path.join(build, "verification_key.json"), "utf8"));

const SALT = 123456789012345678901234567890n;
const CHALLENGE = 987654321098765432109876543210n;

async function prove(vaccinationCount, threshold, salt = SALT, challenge = CHALLENGE) {
  return snarkjs.groth16.fullProve(
    {
      vaccinationCount: vaccinationCount.toString(),
      salt: salt.toString(),
      threshold: threshold.toString(),
      challenge: challenge.toString(),
    },
    wasm,
    zkey
  );
}

// Public signals order: valid, commitment, threshold, challenge.

test("count 3, threshold 2: valid = 1 and the proof verifies", async () => {
  const { proof, publicSignals } = await prove(3, 2);
  assert.equal(publicSignals.length, 4);
  assert.equal(publicSignals[0], "1");
  assert.equal(publicSignals[2], "2");
  assert.equal(publicSignals[3], CHALLENGE.toString());
  assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, proof), true);
});

test("count 1, threshold 2: valid = 0", async () => {
  const { proof, publicSignals } = await prove(1, 2);
  assert.equal(publicSignals[0], "0");
  assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, proof), true);
});

test("count equal to threshold: valid = 1", async () => {
  const { publicSignals } = await prove(2, 2);
  assert.equal(publicSignals[0], "1");
});

test("largest 32-bit count is accepted", async () => {
  const { publicSignals } = await prove(2 ** 32 - 1, 2 ** 32 - 1);
  assert.equal(publicSignals[0], "1");
});

test("commitment equals Poseidon(count, salt) computed outside the circuit", async () => {
  const { publicSignals } = await prove(3, 2);
  assert.equal(publicSignals[1], poseidon2([3n, SALT]).toString());
});

test("different salts give different commitments for the same count", async () => {
  const a = await prove(3, 2, 1n);
  const b = await prove(3, 2, 2n);
  assert.notEqual(a.publicSignals[1], b.publicSignals[1]);
});

test("count of 2^32 is rejected at witness generation", async () => {
  await assert.rejects(() => prove(2 ** 32, 2));
});

test("threshold of 2^32 is rejected at witness generation", async () => {
  await assert.rejects(() => prove(3, 2 ** 32));
});

test("a proof does not verify against another record's commitment", async () => {
  const { proof, publicSignals } = await prove(3, 2);
  const forged = [...publicSignals];
  forged[1] = poseidon2([3n, SALT + 1n]).toString();
  assert.equal(await snarkjs.groth16.verify(vkey, forged, proof), false);
});

test("a proof does not verify under a different challenge", async () => {
  const { proof, publicSignals } = await prove(3, 2);
  const replayed = [...publicSignals];
  replayed[3] = (CHALLENGE + 1n).toString();
  assert.equal(await snarkjs.groth16.verify(vkey, replayed, proof), false);
});

test("a failing claim cannot be passed off as valid", async () => {
  const { proof, publicSignals } = await prove(1, 2);
  const forged = [...publicSignals];
  forged[0] = "1";
  assert.equal(await snarkjs.groth16.verify(vkey, forged, proof), false);
});
