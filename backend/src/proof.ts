import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import * as snarkjs from "snarkjs";

export type GenerateProofBody = {
  vaccinationCount?: unknown;
  threshold?: unknown;
};

function toNonNegativeInt(value: unknown, field: string): number {
  if (typeof value === "string" && value.trim() !== "" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`Invalid ${field}: expected non-negative integer`);
}

export function generateProofHandler(opts: { circuitDir: string }) {
  const wasmPath = path.join(
    opts.circuitDir,
    "vaccination_threshold_js",
    "vaccination_threshold.wasm"
  );
  const zkeyPath = path.join(opts.circuitDir, "circuit_final.zkey");
  const vkeyPath = path.join(opts.circuitDir, "verification_key.json");

  return async (req: Request, res: Response) => {
    try {
      if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath) || !fs.existsSync(vkeyPath)) {
        res.status(503).json({
          error: "Circuit artifacts missing",
          message:
            "Build circuits first (see README): wasm, circuit_final.zkey, verification_key.json required.",
          paths: { wasmPath, zkeyPath, vkeyPath },
        });
        return;
      }

      const body = req.body as GenerateProofBody;
      const vaccinationCount = toNonNegativeInt(body.vaccinationCount, "vaccinationCount");
      const threshold = toNonNegativeInt(body.threshold, "threshold");

      if (vaccinationCount >= 2 ** 32 || threshold >= 2 ** 32) {
        res.status(400).json({
          error: "Out of range",
          message: "Values must fit in 32-bit unsigned range for the demo circuit.",
        });
        return;
      }

      const input = {
        vaccinationCount: vaccinationCount.toString(),
        threshold: threshold.toString(),
      };

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
      );

      const vKey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
      const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);

      const validSignal = publicSignals[0];
      const claimHolds = verified && validSignal === "1";

      res.json({
        proof,
        publicSignals,
        verified: claimHolds,
        note: claimHolds
          ? "Proof verifies and public output valid=1 (count >= threshold)."
          : "Proof did not verify or circuit output was 0 (count < threshold or witness inconsistent).",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith("Invalid ")) {
        res.status(400).json({ error: "Bad request", message });
        return;
      }
      res.status(500).json({ error: "Proof generation failed", message });
    }
  };
}
