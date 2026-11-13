import { useState } from "react";
import {
  DEFAULT_ARTIFACTS,
  checkDisclosure,
  computeCommitment,
  proveThreshold,
  randomFieldElement,
} from "@/lib/zk";

/**
 * In-browser benchmark for the paper's evaluation: time to fetch the circuit
 * artifacts, generate a proof, and verify it, using the same code path as
 * the application. Open /bench?runs=30 and press Run.
 */
const WARMUP = 3;

function summarize(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const q = (p: number) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
  };
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n,
    mean_ms: r(mean),
    stdev_ms: r(Math.sqrt(variance)),
    min_ms: r(s[0]!),
    p5_ms: r(q(0.05)),
    median_ms: r(q(0.5)),
    p95_ms: r(q(0.95)),
    max_ms: r(s[n - 1]!),
  };
}

async function fetchBytes(url: string) {
  const t0 = performance.now();
  const res = await fetch(url, { cache: "no-store" });
  const buf = await res.arrayBuffer();
  return { bytes: buf.byteLength, ms: performance.now() - t0 };
}

export default function Bench() {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const run = async () => {
    const runs = Number(new URLSearchParams(window.location.search).get("runs") ?? 30);
    setResult(null);
    try {
      setStatus("fetching artifacts");
      const wasm = await fetchBytes(DEFAULT_ARTIFACTS.wasm);
      const zkey = await fetchBytes(DEFAULT_ARTIFACTS.zkey);
      const vkey = (await (await fetch(DEFAULT_ARTIFACTS.vkey)).json()) as unknown;

      const count = 3;
      const threshold = 2;
      const salt = randomFieldElement();
      const commitment = computeCommitment(count, salt);

      const proveMs: number[] = [];
      const verifyMs: number[] = [];
      let firstProveMs: number | null = null;
      for (let i = 0; i < WARMUP + runs; i++) {
        setStatus(`run ${i + 1} of ${WARMUP + runs}`);
        const challenge = randomFieldElement();
        const t0 = performance.now();
        const { proof, publicSignals } = await proveThreshold({
          vaccinationCount: count,
          salt,
          threshold,
          challenge,
        });
        const t1 = performance.now();
        const check = await checkDisclosure({
          vkey,
          proof,
          publicSignals,
          expected: { commitment, threshold, challenge },
        });
        const t2 = performance.now();
        if (!check.ok) throw new Error(`self-check failed: ${check.reason}`);
        if (i === 0) firstProveMs = t1 - t0;
        if (i >= WARMUP) {
          proveMs.push(t1 - t0);
          verifyMs.push(t2 - t1);
        }
      }

      setResult({
        recorded_at: new Date().toISOString(),
        user_agent: navigator.userAgent,
        hardware_concurrency: navigator.hardwareConcurrency,
        runs,
        warmup_runs: WARMUP,
        note: "prove = witness generation + Groth16 proving via snarkjs in the browser, artifacts loaded from the same origin. verify = checkDisclosure (signal comparison + Groth16 verification).",
        artifacts: {
          wasm_bytes: wasm.bytes,
          wasm_fetch_ms: Math.round(wasm.ms * 1000) / 1000,
          zkey_bytes: zkey.bytes,
          zkey_fetch_ms: Math.round(zkey.ms * 1000) / 1000,
        },
        first_prove_ms: firstProveMs === null ? null : Math.round(firstProveMs * 1000) / 1000,
        prove: summarize(proveMs),
        verify: summarize(verifyMs),
      });
      setStatus("done");
    } catch (e) {
      setStatus(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="page">
      <h1>In-browser proving benchmark</h1>
      <p className="small">
        Add <span className="mono">?runs=N</span> to the address to change the
        number of measured runs (default 30).
      </p>
      <div className="row">
        <button id="bench-run" type="button" className="btn" onClick={run}>
          Run
        </button>
      </div>
      <p id="bench-status" className="note">
        {status}
      </p>
      {result !== null && (
        <pre id="bench-result" className="mono">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
