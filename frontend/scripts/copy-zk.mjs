// Copies the circuit artifacts the browser needs into public/zk/.
// Run after rebuilding the circuit: npm run copy-zk
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(here, "..", "..", "circuits", "build");
const out = path.join(here, "..", "public", "zk");

const files = [
  ["vaccination_threshold_js/vaccination_threshold.wasm", "vaccination_threshold.wasm"],
  ["circuit_final.zkey", "circuit_final.zkey"],
  ["verification_key.json", "verification_key.json"],
];

fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(build, from);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src}. Build the circuit first (cd circuits && npm run build).`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(out, to));
  console.log(`copied ${to}`);
}
