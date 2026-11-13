// Manual end-to-end fixture for the verifier panel.
//
// Starts a local validator, creates one record whose commitment hides
// vaccinationCount = 3, builds a proof package for threshold 2, prints
// everything a verifier needs, and keeps the validator running until
// interrupted. Point the frontend at it with
//   NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:18899
// and paste the package into the "Verifier: check a proof" form.
import { createRequire } from "node:module";
import path from "node:path";
import {
  ANCHOR_DIR,
  RPC_URL,
  fundedKeypair,
  initRecordBuilder,
  programFor,
  recordPda,
  startValidator,
} from "./localnet.mjs";

const circuits = path.join(ANCHOR_DIR, "..", "circuits");
const require = createRequire(path.join(circuits, "package.json"));
const snarkjs = require("snarkjs");
const { poseidon2 } = require("poseidon-lite");

const COUNT = 3n;
const THRESHOLD = 2;
const SALT = 424242424242424242424242424242n;
const CHALLENGE = 777777777777777777777777777777n;

const toBytes32 = (v) => Uint8Array.from(Buffer.from(v.toString(16).padStart(64, "0"), "hex"));

const validator = await startValidator();
const owner = await fundedKeypair(validator.connection);
const program = programFor(validator.connection, owner);
const timestamp = BigInt(Date.now());
const commitment = poseidon2([COUNT, SALT]);
await initRecordBuilder(
  program,
  owner.publicKey,
  timestamp,
  "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
  toBytes32(commitment)
).rpc();

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  {
    vaccinationCount: COUNT.toString(),
    salt: SALT.toString(),
    threshold: String(THRESHOLD),
    challenge: CHALLENGE.toString(),
  },
  path.join(circuits, "build", "vaccination_threshold_js", "vaccination_threshold.wasm"),
  path.join(circuits, "build", "circuit_final.zkey")
);

console.log(
  JSON.stringify({
    rpc: RPC_URL,
    threshold: THRESHOLD,
    challenge: CHALLENGE.toString(),
    package: { record: recordPda(owner.publicKey, timestamp).toBase58(), proof, publicSignals },
  })
);
console.error("Validator running. Press Ctrl+C to stop.");

const shutdown = async () => {
  await validator.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
