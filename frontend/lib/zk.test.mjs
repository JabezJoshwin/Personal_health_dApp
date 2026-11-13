import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToCommitment,
  checkDisclosure,
  commitmentToBytes,
  computeCommitment,
  parseCount,
  proveThreshold,
  randomFieldElement,
} from "./zk.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const zkDir = path.join(here, "..", "public", "zk");
const artifacts = {
  wasm: path.join(zkDir, "vaccination_threshold.wasm"),
  zkey: path.join(zkDir, "circuit_final.zkey"),
};
const vkey = JSON.parse(fs.readFileSync(path.join(zkDir, "verification_key.json"), "utf8"));

const SALT = 1111111111111111111111111111n;
const CHALLENGE = 2222222222222222222222222222n;

test("parseCount accepts whole numbers and digit strings", () => {
  assert.equal(parseCount(0), 0);
  assert.equal(parseCount(3), 3);
  assert.equal(parseCount(" 7 "), 7);
  assert.equal(parseCount(2 ** 32 - 1), 2 ** 32 - 1);
});

test("parseCount rejects values the circuit cannot represent", () => {
  for (const bad of [-1, 1.5, 2 ** 32, "abc", "", "-3", "1e3", NaN, null, undefined, {}]) {
    assert.throws(() => parseCount(bad), /Vaccination count/, `accepted ${String(bad)}`);
  }
});

test("randomFieldElement stays below 2^248 and varies", () => {
  const a = randomFieldElement();
  const b = randomFieldElement();
  assert.ok(a >= 0n && a < 1n << 248n);
  assert.notEqual(a, b);
});

test("commitment survives the 32-byte big-endian round trip", () => {
  const c = computeCommitment(3, SALT);
  const bytes = commitmentToBytes(c);
  assert.equal(bytes.length, 32);
  assert.equal(bytesToCommitment(bytes), c);
  assert.equal(bytesToCommitment(Array.from(bytes)), c);
});

test("bytesToCommitment rejects the wrong length", () => {
  assert.throws(() => bytesToCommitment(new Uint8Array(31)), /32 bytes/);
});

test("proveThreshold refuses a record with no salt", async () => {
  await assert.rejects(
    () =>
      proveThreshold(
        { vaccinationCount: 3, salt: undefined, threshold: 2, challenge: CHALLENGE },
        artifacts
      ),
    /no salt/
  );
});

test("proveThreshold refuses an out-of-range count before proving", async () => {
  await assert.rejects(
    () =>
      proveThreshold(
        { vaccinationCount: 2 ** 32, salt: SALT, threshold: 2, challenge: CHALLENGE },
        artifacts
      ),
    /Vaccination count/
  );
});

test("a matching proof is accepted", async () => {
  const { proof, publicSignals } = await proveThreshold(
    { vaccinationCount: 3, salt: SALT, threshold: 2, challenge: CHALLENGE },
    artifacts
  );
  const result = await checkDisclosure({
    vkey,
    proof,
    publicSignals,
    expected: { commitment: computeCommitment(3, SALT), threshold: 2, challenge: CHALLENGE },
  });
  assert.deepEqual(result, { ok: true });
});

test("each mismatch is rejected with its own reason", async () => {
  const { proof, publicSignals } = await proveThreshold(
    { vaccinationCount: 3, salt: SALT, threshold: 2, challenge: CHALLENGE },
    artifacts
  );
  const commitment = computeCommitment(3, SALT);
  const check = (expected) => checkDisclosure({ vkey, proof, publicSignals, expected });

  assert.deepEqual(
    await check({ commitment: computeCommitment(3, SALT + 1n), threshold: 2, challenge: CHALLENGE }),
    { ok: false, reason: "commitment mismatch" }
  );
  assert.deepEqual(await check({ commitment, threshold: 3, challenge: CHALLENGE }), {
    ok: false,
    reason: "threshold mismatch",
  });
  assert.deepEqual(await check({ commitment, threshold: 2, challenge: CHALLENGE + 1n }), {
    ok: false,
    reason: "challenge mismatch",
  });
});

test("a true-looking proof of a false claim is rejected", async () => {
  const { proof, publicSignals } = await proveThreshold(
    { vaccinationCount: 1, salt: SALT, threshold: 2, challenge: CHALLENGE },
    artifacts
  );
  const expected = { commitment: computeCommitment(1, SALT), threshold: 2, challenge: CHALLENGE };
  assert.deepEqual(await checkDisclosure({ vkey, proof, publicSignals, expected }), {
    ok: false,
    reason: "claim not satisfied",
  });
  // Flipping the output bit by hand breaks the proof itself.
  const forged = [...publicSignals];
  forged[0] = "1";
  assert.deepEqual(await checkDisclosure({ vkey, proof, publicSignals: forged, expected }), {
    ok: false,
    reason: "invalid proof",
  });
});

test("malformed input is rejected, not thrown", async () => {
  const expected = { commitment: 1n, threshold: 2, challenge: 3n };
  assert.deepEqual(await checkDisclosure({ vkey, proof: {}, publicSignals: ["1"], expected }), {
    ok: false,
    reason: "malformed public signals",
  });
  assert.deepEqual(
    await checkDisclosure({ vkey, proof: {}, publicSignals: ["x", "1", "2", "3"], expected }),
    { ok: false, reason: "malformed public signals" }
  );
  assert.deepEqual(
    await checkDisclosure({ vkey, proof: {}, publicSignals: ["1", "1", "2", "3"], expected }),
    { ok: false, reason: "invalid proof" }
  );
});
