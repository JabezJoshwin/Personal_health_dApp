// Circuit benchmark: size of the constraint system and artifacts, and the
// time to compute a witness, prove, and verify, for the original circuit
// (v1, build-v1/) and the commitment-bound circuit (v2, build/).
//
// Usage: node bench/circuit.mjs [runs]   (default 100)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { timeIt, writeResult } from "../../bench/stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const circuits = path.join(here, "..");
const RUNS = Number(process.argv[2] ?? 100);

const size = (f) => fs.statSync(f).size;

async function benchCircuit(label, dir, input) {
  const r1csPath = path.join(dir, "vaccination_threshold.r1cs");
  const wasm = path.join(dir, "vaccination_threshold_js", "vaccination_threshold.wasm");
  const zkey = path.join(dir, "circuit_final.zkey");
  const vkeyPath = path.join(dir, "verification_key.json");
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));

  const r1cs = await snarkjs.r1cs.info(r1csPath);
  const wtns = path.join(os.tmpdir(), `phr-bench-${label}.wtns`);

  const witness = await timeIt(() => snarkjs.wtns.calculate(input, wasm, wtns), { n: RUNS });
  const prove = await timeIt(() => snarkjs.groth16.prove(zkey, wtns), { n: RUNS });
  const fullProve = await timeIt(() => snarkjs.groth16.fullProve(input, wasm, zkey), { n: RUNS });

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  const verify = await timeIt(
    async () => {
      if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
        throw new Error("verification failed during benchmark");
      }
    },
    { n: RUNS }
  );
  fs.rmSync(wtns, { force: true });

  return {
    r1cs: {
      constraints: r1cs.nConstraints,
      wires: r1cs.nVars,
      private_inputs: r1cs.nPrvInputs,
      public_inputs: r1cs.nPubInputs,
      outputs: r1cs.nOutputs,
      labels: r1cs.nLabels,
    },
    sizes_bytes: {
      r1cs: size(r1csPath),
      wasm: size(wasm),
      zkey: size(zkey),
      verification_key_json: size(vkeyPath),
      proof_json: Buffer.byteLength(JSON.stringify(proof)),
      public_signals_json: Buffer.byteLength(JSON.stringify(publicSignals)),
    },
    public_signals: publicSignals.length,
    timings: { witness, prove, full_prove: fullProve, verify },
  };
}

const v1 = await benchCircuit("v1", path.join(circuits, "build-v1"), {
  vaccinationCount: "3",
  threshold: "2",
});
const v2 = await benchCircuit("v2", path.join(circuits, "build"), {
  vaccinationCount: "3",
  salt: "123456789012345678901234567890",
  threshold: "2",
  challenge: "987654321098765432109876543210",
});

writeResult("circuit.json", {
  recorded_at: new Date().toISOString(),
  runs: RUNS,
  warmup_runs: 5,
  note: "Timings are wall-clock in Node.js; snarkjs uses worker threads. v1 is the original threshold-only circuit; v2 adds range checks, the Poseidon commitment and the challenge.",
  v1,
  v2,
});
process.exit(0);
