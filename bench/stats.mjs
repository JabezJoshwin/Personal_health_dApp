// Small statistics helpers shared by the benchmark scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = path.join(here, "results");

export function summarize(samplesMs) {
  const s = [...samplesMs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  // Linear-interpolated quantile.
  const q = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  const r = (x) => Math.round(x * 1000) / 1000;
  return {
    n,
    mean_ms: r(mean),
    stdev_ms: r(Math.sqrt(variance)),
    min_ms: r(s[0]),
    p5_ms: r(q(0.05)),
    median_ms: r(q(0.5)),
    p95_ms: r(q(0.95)),
    max_ms: r(s[n - 1]),
  };
}

/** Runs `fn` `warmup` times unmeasured, then `n` times measured. */
export async function timeIt(fn, { n, warmup = 5 }) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    samples.push(performance.now() - t0);
  }
  return summarize(samples);
}

export function writeResult(name, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
