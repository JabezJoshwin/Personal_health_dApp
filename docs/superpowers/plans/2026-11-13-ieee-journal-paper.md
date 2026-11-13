# Journal Paper and Privacy Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the dApp's two privacy gaps, measure the result, and write a journal paper about it, built in IEEE and Springer Nature layouts.

**Architecture:** The circuit gains a salted Poseidon commitment and a verifier challenge; the Anchor program stores the commitment with each record; the browser generates proofs and a verifier checks them against the on-chain commitment. Benchmarks write JSON that the paper's tables are generated from. One LaTeX body feeds two wrapper files.

**Tech Stack:** Circom 2.2.3, snarkjs 0.7.x, circomlib, poseidon-lite, Anchor (CLI 0.32.1), solana-test-validator, Next.js 14, Express, Node 24 test runner, LaTeX via tectonic.

**Spec:** `docs/superpowers/specs/2026-11-13-ieee-journal-paper-design.md`

## Global Constraints

- No fabricated or estimated number presented as measured; every number in the paper comes from a file in `bench/results/`.
- No reference that was not opened and checked; each has a line in `paper/references-verified.md`.
- Sources: peer-reviewed papers (IEEE, ACM, Springer, Elsevier, USENIX, IACR venues), standards (NIST, IETF), and primary specifications or official documentation of the tools used.
- No Devnet deployment, no `git push`, no journal submission, no use of the Pinata key.
- Public signals order: `valid`, `commitment`, `threshold`, `challenge`.
- `salt` and `challenge`: 31 random bytes each. Commitment on-chain: 32 bytes, big-endian.
- Target journal rules (SN Computer Science): structured abstract of 150–250 words, 4–6 keywords, numbered citations in square brackets, LLM use documented in the Methods part.
- Authors: M. Jabez Joshwin Paul (first, with email); Dr. E. Bijolin Edwin (no email).

## Review Focus

1. A vaccination count that is negative, fractional, or ≥ 2^32 entered in the UI → rejected before proving, with a readable message (Task 3 test).
2. A record that has no salt (created before this change) → proving refuses with "record has no salt" rather than producing a proof for a different commitment (Task 3 test).
3. A valid proof presented against a different record's commitment → verifier rejects and says the commitment does not match (Task 1 and Task 3 tests).
4. A proof replayed with a different challenge → verifier rejects (Task 1 test).
5. A CID longer than 128 bytes → program rejects with `CidTooLong` (Task 2 test).

---

### Task 1: Circuit with commitment, challenge and range checks

**Files:**
- Modify: `circuits/vaccination_threshold.circom`, `circuits/package.json`
- Create: `circuits/test/circuit.test.mjs`
- Regenerate: `circuits/build/` artifacts (keep the old `circuit_final.zkey`, `verification_key.json` and wasm as `circuits/build-v1/` for the before/after comparison)

**Interfaces:**
- Produces: circuit inputs `{vaccinationCount, salt, threshold, challenge}` (decimal strings); public signals `[valid, commitment, threshold, challenge]`; artifacts at `circuits/build/vaccination_threshold_js/vaccination_threshold.wasm`, `circuits/build/circuit_final.zkey`, `circuits/build/verification_key.json`, `circuits/build/vaccination_threshold.r1cs`.

- [ ] **Step 1:** Copy the current build artifacts to `circuits/build-v1/` and compile the old circuit's r1cs there.
- [ ] **Step 2:** Write `circuits/test/circuit.test.mjs` (Node test runner, snarkjs, poseidon-lite) with tests: `count 3, threshold 2 → valid = 1 and verifies`; `count 1, threshold 2 → valid = 0`; `count == threshold → valid = 1`; `commitment equals poseidon2([count, salt])`; `count = 2^32 → witness generation throws`; `changing publicSignals[1] (commitment) → verify false`; `changing publicSignals[3] (challenge) → verify false`.
- [ ] **Step 3:** Run `npm test` in `circuits/`; expect failures (old circuit has no salt).
- [ ] **Step 4:** Rewrite the circuit: `Num2Bits(32)` on `vaccinationCount` and `threshold`, `Poseidon(2)` commitment, `challenge` bound by a squaring constraint, `component main { public [threshold, challenge] }`.
- [ ] **Step 5:** `npm run build`; run `npm test`; expect all pass.
- [ ] **Step 6:** Commit.

### Task 2: Anchor program stores the commitment

**Files:**
- Modify: `anchor/programs/health-record/src/lib.rs`, `anchor/Anchor.toml`, `frontend/idl/health_record.json`
- Create: `anchor/tests/health_record.test.mjs`

**Interfaces:**
- Produces: `init_record(timestamp: i64, ipfs_cid: String, commitment: [u8; 32])`; account `HealthRecord { owner, ipfs_cid, timestamp, commitment }`; IDL at `anchor/target/idl/health_record.json`.

- [ ] **Step 1:** Write the test (runs against `solana-test-validator` with the built program): record created with CID, timestamp and commitment read back equal; a 129-byte CID fails with `CidTooLong`.
- [ ] **Step 2:** Update the program; `anchor build`; copy the IDL to the frontend.
- [ ] **Step 3:** Run the test against a local validator; expect pass.
- [ ] **Step 4:** Commit.

### Task 3: Browser proving, verifier check, verify-only backend

**Files:**
- Create: `frontend/lib/zk.ts`, `frontend/lib/zk.test.mjs`, `frontend/public/zk/` (wasm, zkey, vkey copies), `frontend/scripts/copy-zk.mjs`
- Modify: `frontend/lib/solana.ts`, `frontend/lib/types.ts`, `frontend/pages/index.tsx`, `frontend/package.json`, `backend/src/proof.ts`, `backend/src/index.ts`

**Interfaces:**
- Consumes: Task 1 artifacts and signal order; Task 2 instruction.
- Produces, in `frontend/lib/zk.ts`:
  - `randomFieldElement(): bigint`
  - `parseCount(value: unknown): number` (throws on non-integer, negative, or ≥ 2^32)
  - `computeCommitment(count: number, salt: bigint): bigint`
  - `commitmentToBytes(c: bigint): Uint8Array` and `bytesToCommitment(b: Uint8Array): bigint`
  - `proveThreshold(input: { vaccinationCount: number; salt: bigint | undefined; threshold: number; challenge: bigint }, artifacts?: { wasm: string; zkey: string }): Promise<{ proof: unknown; publicSignals: string[] }>` (throws `record has no salt` when salt is undefined)
  - `checkDisclosure(args: { vkey: unknown; proof: unknown; publicSignals: string[]; expected: { commitment: bigint; threshold: number; challenge: bigint } }): Promise<{ ok: boolean; reason?: string }>`
- Backend: `POST /verify-proof` with `{ proof, publicSignals }` → `{ verified, valid, commitment, threshold, challenge }`.

- [ ] **Step 1:** Write `zk.test.mjs`: `parseCount` rejects `-1`, `1.5`, `2**32`, `"abc"`; `proveThreshold` with undefined salt rejects with `record has no salt`; `checkDisclosure` returns `ok` for a matching proof and `reason: "commitment mismatch"`, `"challenge mismatch"`, `"threshold mismatch"`, `"claim not satisfied"` for each mismatch; byte round-trip of the commitment.
- [ ] **Step 2:** Implement `zk.ts`; run tests; expect pass.
- [ ] **Step 3:** Wire the page: salt generated and stored inside the encrypted record; commitment sent with `init_record`; proving in the browser; a verifier panel that reads the commitment from a record address and calls `checkDisclosure`.
- [ ] **Step 4:** Replace the backend's `/generate-proof` with `/verify-proof`.
- [ ] **Step 5:** `npm run build` in `frontend/` and `backend/`; expect success. Run the app on localhost and generate and verify one proof in the browser.
- [ ] **Step 6:** Rewrite `README.md` and `docs/ARCHITECTURE.md` to match the code. Commit.

### Task 4: Benchmarks

**Files:**
- Create: `bench/package.json`, `bench/circuit.mjs`, `bench/crypto.mjs`, `bench/chain.mjs`, `bench/env.mjs`, `bench/results/*.json`, `frontend/pages/bench.tsx`

**Interfaces:**
- Produces: `bench/results/env.json`, `circuit.json` (r1cs stats and sizes for v1 and v2; witness, prove, verify timings with n, median, mean, p5, p95), `crypto.json` (PBKDF2 and AES-GCM timings per payload size), `chain.json` (account size, rent, transaction size, compute units, fee), `browser.json` (in-browser prove and verify timings).

- [ ] **Step 1:** Write the scripts; each prints and writes its JSON.
- [ ] **Step 2:** Run them; inspect outputs for plausibility. Commit scripts and results.

### Task 5: References

**Files:**
- Create: `paper/refs.bib`, `paper/references-verified.md`

- [ ] **Step 1:** For each candidate reference, open the publisher page, DOI, standards page or official documentation and record title, authors, venue, year, pages and DOI exactly as shown there.
- [ ] **Step 2:** Drop any reference that cannot be opened and checked. Commit.

### Task 6: Paper

**Files:**
- Create: `paper/body.tex`, `paper/abstract.tex`, `paper/main-ieee.tex`, `paper/main-springer.tex`, `paper/tables/*.tex` (generated), `paper/scripts/make-tables.mjs`, `paper/build.sh`, `paper/figures/*`

- [ ] **Step 1:** Generate tables from `bench/results/` with `make-tables.mjs`.
- [ ] **Step 2:** Write the body and both wrappers. Sections as in the spec.
- [ ] **Step 3:** Build both PDFs with `paper/build.sh`; expect no undefined citations or references.
- [ ] **Step 4:** Check: every `\cite` key exists in `refs.bib` and in `references-verified.md`; every number in the text matches `bench/results/`; abstract is 150–250 words; 4–6 keywords; AI disclosure present. Commit.
