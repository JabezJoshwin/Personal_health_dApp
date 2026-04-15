# Architecture

## Components

| Layer | Role |
|--------|------|
| **Next.js frontend** | Phantom wallet, AES-GCM encryption in the browser, Pinata IPFS upload (via server API route), Anchor client calls to Devnet. |
| **Express backend** | `POST /generate-proof`: witness + Groth16 prove + Groth16 verify using SnarkJS and files under `circuits/build/`. |
| **Anchor program** | One PDA per wallet (`seeds = ["health", owner]`) storing `owner`, `ipfs_cid`, `timestamp`. Instructions: `init_record`, `update_record`. |
| **Circom circuit** | Single relation: `vaccinationCount >= threshold` using `circomlib` `LessThan` on `threshold` and `vaccinationCount + 1`. Public outputs: `threshold`, `valid`. |
| **IPFS (Pinata)** | Stores **encrypted** JSON (ciphertext + salt + iv); the chain stores only the CID string. |

## Trust & privacy (MVP scope)

- **Client encryption**: The demo passphrase never leaves the browser; only ciphertext is uploaded.
- **ZK**: The proof shows that the private count satisfies the threshold against public `threshold` and `valid`; the backend learns `vaccinationCount` when it builds the witness—acceptable for a class demo, not a production “verifier learns nothing” deployment.
- **No on-chain ZK**: The program does not verify proofs; selective disclosure is demonstrated off-chain.

## Data flow (happy path)

1. User edits the health JSON and passphrase → `encryptJson` → encrypted payload.
2. `POST /api/pin-to-ipfs` (Next.js) pins JSON with **Pinata** → CID.
3. `init_record` or `update_record` → store CID on Devnet.
4. User clicks **Generate proof** → frontend POSTs counts → backend runs SnarkJS → UI shows `verified` and public signals.
