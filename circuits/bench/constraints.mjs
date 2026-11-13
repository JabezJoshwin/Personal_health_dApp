// Records how the constraint count of the bound circuit depends on the
// compiler's simplification level, and what the build actually uses.
// Compiles into a temporary directory; does not touch build/.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { writeResult } from "../../bench/stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const circuits = path.join(here, "..");
const src = path.join(circuits, "vaccination_threshold.circom");

async function compile(flag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phr-constraints-"));
  const stdout = execFileSync(
    "circom",
    [src, "--r1cs", flag, "-o", dir, "-l", path.join(circuits, "node_modules")],
    { encoding: "utf8" }
  );
  const pick = (label) => Number(stdout.match(new RegExp(`(?<!non-)${label}: (\\d+)`))[1]);
  const info = await snarkjs.r1cs.info(path.join(dir, "vaccination_threshold.r1cs"));
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    non_linear_constraints: Number(stdout.match(/non-linear constraints: (\d+)/)[1]),
    linear_constraints: pick("linear constraints"),
    total_constraints: info.nConstraints,
    wires: info.nVars,
  };
}

const built = await snarkjs.r1cs.info(path.join(circuits, "build", "vaccination_threshold.r1cs"));
writeResult("constraints.json", {
  recorded_at: new Date().toISOString(),
  note: "The shipped build is compiled with --O2 (full constraint simplification). O1 is reported for comparison only; no timing in this repository was measured with an O1 build of the bound circuit.",
  shipped_build_total_constraints: built.nConstraints,
  O1: await compile("--O1"),
  O2: await compile("--O2"),
});
process.exit(0);
