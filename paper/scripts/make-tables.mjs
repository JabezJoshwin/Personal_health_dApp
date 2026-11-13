// Generates paper/generated/*.tex from bench/results/*.json so that every
// number printed in the paper is copied from a recorded measurement.
//
// Usage: node paper/scripts/make-tables.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const results = path.join(here, "..", "..", "bench", "results");
const out = path.join(here, "..", "generated");
const load = (f) => JSON.parse(fs.readFileSync(path.join(results, f), "utf8"));

const env = load("env.json");
const circuit = load("circuit.json");
const crypto = load("crypto.json");
const chain = load("chain.json");
const browser = load("browser.json");
const constraints = load("constraints.json");
if (constraints.shipped_build_total_constraints !== circuit.v2.r1cs.constraints) {
  throw new Error("constraints.json and circuit.json describe different builds; re-run the benchmarks");
}

/** 1751226 -> 1{,}751{,}226 */
const int = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "{,}");
const ms = (x, d = 1) => x.toFixed(d);
const range = (t, d = 1) => `${ms(t.median_ms, d)} (${ms(t.p5_ms, d)}--${ms(t.p95_ms, d)})`;
const only = (arr, what) => {
  if (arr.length !== 1) throw new Error(`expected a single ${what}, got ${JSON.stringify(arr)}`);
  return arr[0];
};

const { v1, v2 } = circuit;
const cu = chain.init_record.compute_units;
const cuSteps = cu.distinct.slice(1).map((x, i) => x - cu.distinct[i]);
const cuStep = only([...new Set(cuSteps)], "compute-unit step");

const macros = {
  // environment
  EnvCpu: env.hardware.cpu,
  EnvCores: env.hardware.logical_cores,
  EnvPerfCores: env.hardware.performance_cores,
  EnvEffCores: env.hardware.efficiency_cores,
  EnvMemGb: env.hardware.memory_gb,
  EnvMacos: env.os.product,
  EnvNode: env.versions.node.replace(/^v/, ""),
  EnvCircom: env.versions.circom.replace(/^circom compiler /, ""),
  EnvSnarkjs: env.versions.snarkjs,
  EnvCircomlib: env.versions.circomlib,
  EnvAnchorLang: env.versions.anchor_lang,
  EnvSolana: env.versions.solana_cli.match(/solana-cli (\S+)/)[1],
  EnvBrowser: browser.browser_engine,
  // circuit
  OldConstraints: int(v1.r1cs.constraints),
  NewConstraints: int(v2.r1cs.constraints),
  OldWires: int(v1.r1cs.wires),
  NewWires: int(v2.r1cs.wires),
  NewWasmBytes: int(v2.sizes_bytes.wasm),
  NewWasmMb: (v2.sizes_bytes.wasm / 1e6).toFixed(2),
  OldWasmKb: (v1.sizes_bytes.wasm / 1e3).toFixed(1),
  NewZkeyKb: (v2.sizes_bytes.zkey / 1e3).toFixed(1),
  OldZkeyKb: (v1.sizes_bytes.zkey / 1e3).toFixed(1),
  NewProofBytes: int(v2.sizes_bytes.proof_json),
  NewSignalsBytes: int(v2.sizes_bytes.public_signals_json),
  UnsimplifiedConstraints: int(constraints.O1.total_constraints),
  UnsimplifiedLinear: int(constraints.O1.linear_constraints),
  UnsimplifiedNonLinear: int(constraints.O1.non_linear_constraints),
  NodeRuns: circuit.runs,
  NodeWarmup: circuit.warmup_runs,
  OldFullProveMs: ms(v1.timings.full_prove.median_ms),
  NewFullProveMs: ms(v2.timings.full_prove.median_ms),
  NewWitnessMs: ms(v2.timings.witness.median_ms),
  NewProveMs: ms(v2.timings.prove.median_ms),
  OldVerifyMs: ms(v1.timings.verify.median_ms),
  NewVerifyMs: ms(v2.timings.verify.median_ms),
  ProveSlowdown: (v2.timings.full_prove.median_ms / v1.timings.full_prove.median_ms).toFixed(1),
  ConstraintGrowth: (v2.r1cs.constraints / v1.r1cs.constraints).toFixed(1),
  // browser
  BrowserRuns: browser.runs,
  BrowserWarmup: browser.warmup_runs,
  BrowserProveMs: ms(browser.prove.median_ms),
  BrowserProvePninetyfive: ms(browser.prove.p95_ms),
  NodeProvePninetyfive: ms(v2.timings.full_prove.p95_ms),
  BrowserVerifyMs: ms(browser.verify.median_ms),
  BrowserFirstProveMs: ms(browser.first_prove_ms),
  // encryption
  CryptoRuns: crypto.runs,
  KdfIterations: int(crypto.parameters.iterations),
  KdfMs: ms(crypto.key_derivation.median_ms),
  EncSampleMs: ms(crypto.payloads[0].encrypt.median_ms),
  EncLargestMs: ms(crypto.payloads.at(-1).encrypt.median_ms),
  SamplePlainBytes: int(crypto.payloads[0].plaintext_bytes),
  SampleStoredBytes: int(crypto.payloads[0].stored_bytes),
  // chain
  ChainRuns: chain.runs,
  AccountBytes: int(chain.account.bytes),
  OldAccountBytes: int(chain.account.v1_bytes),
  RentLamports: int(chain.account.rent_exempt_lamports),
  RentSol: chain.account.rent_exempt_sol.toFixed(7),
  OldRentLamports: int(chain.account.v1_rent_exempt_lamports),
  RentIncreaseLamports: int(chain.account.rent_exempt_lamports - chain.account.v1_rent_exempt_lamports),
  TxBytes: int(only(chain.init_record.transaction_bytes, "transaction size")),
  TxLimitBytes: int(chain.init_record.transaction_size_limit_bytes),
  TxPercentOfLimit: ((100 * only(chain.init_record.transaction_bytes, "transaction size")) / chain.init_record.transaction_size_limit_bytes).toFixed(0),
  CuMin: int(cu.min),
  CuMax: int(cu.max),
  CuStep: int(cuStep),
  FeeLamports: int(only(chain.init_record.fee_lamports, "fee")),
  OwnerDebitLamports: int(chain.init_record.owner_debit_lamports_first_tx),
  LocalConfirmMs: ms(chain.local_confirmation.median_ms, 0),
  CidChars: chain.cid_length_chars,
};

const lines = [
  "% GENERATED by paper/scripts/make-tables.mjs from bench/results/*.json. Do not edit.",
  ...Object.entries(macros).map(([k, v]) => `\\newcommand{\\${k}}{${v}}`),
];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "numbers.tex"), lines.join("\n") + "\n");

const header = "% GENERATED by paper/scripts/make-tables.mjs. Do not edit.\n";

// Table: circuit size
const sz = (label, a, b) => `${label} & ${int(a)} & ${int(b)} \\\\`;
fs.writeFileSync(
  path.join(out, "table-circuit.tex"),
  header +
    [
      "\\begin{tabular}{@{}lrr@{}}",
      "\\toprule",
      "Quantity & Baseline & Bound \\\\",
      "\\midrule",
      sz("R1CS constraints", v1.r1cs.constraints, v2.r1cs.constraints),
      sz("Wires", v1.r1cs.wires, v2.r1cs.wires),
      sz("Private inputs", v1.r1cs.private_inputs, v2.r1cs.private_inputs),
      sz("Public signals", v1.public_signals, v2.public_signals),
      "\\midrule",
      sz("Witness generator (bytes)", v1.sizes_bytes.wasm, v2.sizes_bytes.wasm),
      sz("Proving key (bytes)", v1.sizes_bytes.zkey, v2.sizes_bytes.zkey),
      sz("Verification key, JSON (bytes)", v1.sizes_bytes.verification_key_json, v2.sizes_bytes.verification_key_json),
      sz("Proof, JSON (bytes)", v1.sizes_bytes.proof_json, v2.sizes_bytes.proof_json),
      sz("Public signals, JSON (bytes)", v1.sizes_bytes.public_signals_json, v2.sizes_bytes.public_signals_json),
      "\\bottomrule",
      "\\end{tabular}",
    ].join("\n") +
    "\n"
);

// Table: timings
fs.writeFileSync(
  path.join(out, "table-timing.tex"),
  header +
    [
      "\\begin{tabular}{@{}lrr@{}}",
      "\\toprule",
      "Operation & Baseline & Bound \\\\",
      "\\midrule",
      `\\multicolumn{3}{@{}l}{\\emph{Node.js, $n=${circuit.runs}$}} \\\\`,
      `Witness generation & ${range(v1.timings.witness)} & ${range(v2.timings.witness)} \\\\`,
      `Groth16 proving & ${range(v1.timings.prove)} & ${range(v2.timings.prove)} \\\\`,
      `Witness + proving & ${range(v1.timings.full_prove)} & ${range(v2.timings.full_prove)} \\\\`,
      `Verification & ${range(v1.timings.verify)} & ${range(v2.timings.verify)} \\\\`,
      "\\midrule",
      `\\multicolumn{3}{@{}l}{\\emph{Browser (${browser.browser_engine}), $n=${browser.runs}$}} \\\\`,
      `Witness + proving & --- & ${range(browser.prove)} \\\\`,
      `Verifier check & --- & ${range(browser.verify)} \\\\`,
      "\\bottomrule",
      "\\end{tabular}",
    ].join("\n") +
    "\n"
);

// Table: encryption
fs.writeFileSync(
  path.join(out, "table-crypto.tex"),
  header +
    [
      "\\begin{tabular}{@{}rrrr@{}}",
      "\\toprule",
      "Plaintext & Stored & Encrypt & Decrypt \\\\",
      "(bytes) & (bytes) & (ms) & (ms) \\\\",
      "\\midrule",
      ...crypto.payloads.map(
        (p) =>
          `${int(p.plaintext_bytes)} & ${int(p.stored_bytes)} & ${ms(p.encrypt.median_ms)} & ${ms(p.decrypt.median_ms)} \\\\`
      ),
      "\\bottomrule",
      "\\end{tabular}",
    ].join("\n") +
    "\n"
);

// Table: on-chain cost
fs.writeFileSync(
  path.join(out, "table-chain.tex"),
  header +
    [
      "\\begin{tabular}{@{}lr@{}}",
      "\\toprule",
      "Quantity & Value \\\\",
      "\\midrule",
      `Record account size (bytes) & ${int(chain.account.bytes)} \\\\`,
      `Rent-exempt deposit (lamports) & ${int(chain.account.rent_exempt_lamports)} \\\\`,
      `Transaction size (bytes) & ${macros.TxBytes} \\\\`,
      `Compute units consumed & ${int(cu.min)}--${int(cu.max)} \\\\`,
      `Transaction fee (lamports) & ${macros.FeeLamports} \\\\`,
      `Total debit to owner (lamports) & ${int(chain.init_record.owner_debit_lamports_first_tx)} \\\\`,
      "\\bottomrule",
      "\\end{tabular}",
    ].join("\n") +
    "\n"
);

// Figure data: median with p5/p95 whiskers, in ms
const bar = (label, t) =>
  `(${label},${t.median_ms}) +- (0,${(t.p95_ms - t.median_ms).toFixed(3)}) -= (0,${(t.median_ms - t.p5_ms).toFixed(3)})`;
fs.writeFileSync(
  path.join(out, "figure-timing-data.tex"),
  header +
    [
      `\\newcommand{\\TimingBaselineCoords}{${bar("Prove (Node)", v1.timings.full_prove)} ${bar("Verify (Node)", v1.timings.verify)}}`,
      `\\newcommand{\\TimingBoundCoords}{${bar("Prove (Node)", v2.timings.full_prove)} ${bar("Verify (Node)", v2.timings.verify)} ${bar("Prove (browser)", browser.prove)} ${bar("Verify (browser)", browser.verify)}}`,
    ].join("\n") +
    "\n"
);

console.log(`wrote ${Object.keys(macros).length} macros and 4 tables to paper/generated/`);
