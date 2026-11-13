# Architecture

## Components

| Layer | Role |
|--------|------|
| **Next.js frontend** | Phantom wallet, AES-GCM encryption, Poseidon commitment, Groth16 proving and verifying, all in the browser. Pinata upload goes through a server API route. Anchor client calls to Devnet. |
| **Anchor program** | One PDA per upload (`seeds = ["record", owner, timestamp_le_bytes]`) storing `owner`, `ipfs_cid` (max 128 bytes), `timestamp`, `commitment` (32 bytes). One instruction: `init_record`. Accounts are never updated or closed. |
| **Circom circuit** | Private inputs `vaccinationCount`, `salt`; public inputs `threshold`, `challenge`; public outputs `valid`, `commitment`. Enforces 32-bit ranges, `commitment = Poseidon(vaccinationCount, salt)`, and `valid = 1` iff `vaccinationCount >= threshold`. |
| **IPFS (Pinata)** | Stores **encrypted** JSON (ciphertext + salt + iv). The encrypted record includes the commitment salt. |
| **Express backend (optional)** | `POST /verify-proof`: Groth16 verification only. Receives no private input. |

Public signal order: `valid`, `commitment`, `threshold`, `challenge`.

## Data flow

**Create a record**

1. Browser samples a 31-byte salt and computes `commitment = Poseidon(count, salt)`.
2. Browser encrypts the record (including the salt) with a key derived from the passphrase.
3. `POST /api/pin-to-ipfs` pins the ciphertext → CID.
4. `init_record(timestamp, cid, commitment)` creates the record account.

**Disclose**

1. Verifier picks a threshold and a fresh random challenge and gives both to the owner.
2. Owner's browser proves and returns `{ record, proof, publicSignals }`.
3. Verifier reads the commitment from the record account on Solana.
4. Verifier accepts only if the proof verifies, `valid == 1`, and the commitment, threshold and challenge equal the expected values (`checkDisclosure` in `frontend/lib/zk.ts`).

## Trust and privacy

- **Local proving:** the count and salt never leave the owner's browser.
- **Binding:** a proof is about the value committed when the record was created; the commitment is read from the chain, not from the prover.
- **Freshness:** a proof made for one challenge is rejected for another.

## Known limitations

- The count is **self-asserted**: no issuer signs it.
- A proof is not bound to the presenter's wallet key, so a relay is possible.
- Asking for several thresholds reveals the count step by step.
- The Groth16 setup is single-contributor.
- The passphrase protects a ciphertext that is public forever; PBKDF2 uses 120,000 iterations, below current OWASP guidance.
- Records are linked to the wallet address and cannot be revoked or erased.
- Proofs are verified off-chain.
