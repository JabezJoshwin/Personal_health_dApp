import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import * as snarkjs from "snarkjs";

/**
 * Verify-only endpoint.
 *
 * Proofs are generated in the record owner's browser, so this server never
 * receives the private vaccination count or its salt. It checks that a
 * Groth16 proof is valid for the public signals it was given and reports
 * what those signals say. Deciding whether the commitment, threshold and
 * challenge are the ones the verifier expects is the verifier's job: the
 * commitment must be read from the on-chain record, not taken from here.
 *
 * Public signals, in order: valid, commitment, threshold, challenge.
 */
export type VerifyProofBody = {
  proof?: unknown;
  publicSignals?: unknown;
};

const PUBLIC_SIGNAL_COUNT = 4;

function isSignalArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === PUBLIC_SIGNAL_COUNT &&
    value.every((s) => typeof s === "string" && /^\d+$/.test(s))
  );
}

export function verifyProofHandler(opts: { circuitDir: string }) {
  const vkeyPath = path.join(opts.circuitDir, "verification_key.json");

  return async (req: Request, res: Response) => {
    if (!fs.existsSync(vkeyPath)) {
      res.status(503).json({
        error: "Verification key missing",
        message: "Build circuits first (see README): verification_key.json is required.",
      });
      return;
    }

    const body = (req.body ?? {}) as VerifyProofBody;
    if (typeof body.proof !== "object" || body.proof === null || !isSignalArray(body.publicSignals)) {
      res.status(400).json({
        error: "Bad request",
        message: `Expected { proof, publicSignals } with ${PUBLIC_SIGNAL_COUNT} decimal-string public signals.`,
      });
      return;
    }

    const [valid, commitment, threshold, challenge] = body.publicSignals;
    let verified = false;
    try {
      const vKey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
      verified = await snarkjs.groth16.verify(vKey, body.publicSignals, body.proof);
    } catch {
      // A structurally broken proof is simply not a valid proof.
      verified = false;
    }

    res.json({
      verified,
      claimHolds: verified && valid === "1",
      valid,
      commitment,
      threshold,
      challenge,
    });
  };
}
