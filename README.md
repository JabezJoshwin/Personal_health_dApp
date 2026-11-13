# Decentralized Personal Health Record (Solana + IPFS + ZK demo)

Research prototype: **encrypted** health JSON on **IPFS (Pinata)**, its **CID and a commitment on Solana Devnet** via **Anchor**, and a **Circom/SnarkJS** proof that `vaccinationCount >= threshold`. The proof is generated **in the owner's browser**, is tied to the on-chain record through a **Poseidon commitment**, and is tied to one verification session through a **verifier-chosen challenge**. **Phantom** is used through the **Solana wallet adapter**. No custom token, no on-chain ZK verification, Devnet only. Do not use real health data.

## Repository layout

```
personalHealth-dApp/
├── frontend/          # Next.js + React + TypeScript; proves and verifies in the browser
├── backend/           # Express + TypeScript; optional verify-only service
├── anchor/            # Anchor program (CID + commitment), tests, on-chain benchmark
├── circuits/          # Circom circuit, tests, build scripts, circuit benchmark
├── bench/             # Benchmark helpers and recorded results (bench/results/*.json)
├── paper/             # Journal paper: LaTeX source, references, built PDFs
├── docs/              # Architecture + sample data
├── .env.example
└── README.md
```

## Architecture (short)

- **Browser (owner):** picks a random salt, computes `commitment = Poseidon(vaccinationCount, salt)`, encrypts the record (salt included) with AES-GCM, pins the ciphertext to IPFS through a Next.js API route, then calls `init_record` with the CID and the commitment.
- **Chain:** one PDA per upload (`seeds = ["record", owner, timestamp]`) holding `owner`, `ipfs_cid`, `timestamp`, `commitment`.
- **Browser (owner), later:** generates a Groth16 proof for a verifier's threshold and challenge. The count and salt never leave the device.
- **Verifier:** reads the commitment from the record account and accepts only if the proof is valid, `valid = 1`, and the commitment, threshold and challenge all match.
- **Backend (optional):** `POST /verify-proof` checks a proof against the verification key. It never receives private inputs.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How the ZK piece works (simple explanation)

When a record is uploaded, the app stores a **commitment** on-chain: a hash of the vaccination count mixed with a random secret salt. The hash reveals nothing about the count, but it fixes it.

Later, a verifier asks "is the count at least N?" and sends a fresh random **challenge**. The owner's browser produces a short **proof** that says: "I know a count and a salt that hash to the commitment in that on-chain record, the count is at least N, and I made this proof for your challenge." The verifier checks the proof against the commitment it reads from Solana itself.

What this does **not** show: that the count is medically true. The owner chose the number; no clinic has signed it. See the limitations section of the paper.

## Prerequisites

- **Node.js** ≥ 20.18 recommended (Solana-related packages may warn below that).
- **Rust + Solana CLI + Anchor** (see [Anchor docs](https://www.anchor-lang.com/docs/installation)).
- **Circom 2** ([installation](https://docs.circom.io/getting-started/installation/)).
- **Phantom** browser wallet.
- **Devnet SOL** (`solana airdrop 2 <ADDRESS> --url devnet`).
- **Pinata** account and **JWT** with permission to pin JSON to IPFS (see [Environment variables](#environment-variables)).

## Environment variables

Copy [`.env.example`](.env.example) and create:

| File | Variables |
|------|-----------|
| `frontend/.env.local` | `NEXT_PUBLIC_SOLANA_NETWORK=devnet`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_API_URL`, **`PINATA_JWT`** (server-only; not prefixed with `NEXT_PUBLIC_`) |
| `backend/.env` | `PORT`, `CIRCUIT_BUILD_DIR` (default `../circuits/build`), `CORS_ORIGIN` |

**Pinata:** Create a JWT in the [Pinata API keys dashboard](https://app.pinata.cloud/developers/api-keys) with permission to **pin JSON to IPFS**. Put it in `frontend/.env.local` as `PINATA_JWT=...`. The browser calls `POST /api/pin-to-ipfs`; that route forwards to Pinata so the secret stays on the server and you avoid browser CORS issues with the Pinata API.

## Install dependencies

From the repo root (each package is independent—**no** root `npm workspaces`):

```bash
cd circuits && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

## Build the circuit (wasm, zkey, verification key)

Requires **circom** on your `PATH`:

```bash
cd circuits
npm run build            # compile (with --O2), then scripts/full-build.sh → zkey + verification key
npm test                 # 11 circuit tests
```

Then copy the artifacts the browser needs into the frontend:

```bash
cd ../frontend
npm run copy-zk          # → frontend/public/zk/
```

Artifacts used at run time:

- `frontend/public/zk/vaccination_threshold.wasm`, `circuit_final.zkey`, `verification_key.json` (browser)
- `circuits/build/verification_key.json` (optional backend)

The first build generates a **powers-of-tau** file under `circuits/build/` (can take a minute or two). This is a single-contributor setup: fine for a prototype, not for production.

`circuits/build-v1/` keeps the original threshold-only circuit so the benchmarks can compare against it.

## Anchor program: build, deploy Devnet, sync program id

```bash
cd anchor
anchor build
```

Deploy (uses the wallet in `anchor/Anchor.toml`, cluster **Devnet**):

```bash
anchor deploy --provider.cluster devnet
```

Sync `declare_id!` and `Anchor.toml` with your keypair (recommended):

```bash
anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
```

Run the program tests against a throwaway local validator (does not touch Devnet or your wallet):

```bash
npm install
npm test                 # 6 program tests
```

**The account layout changed** (a 32-byte commitment was added), so the program must be redeployed to Devnet before the frontend works there. Records created by the old program are ignored by the new client.

Copy the program id into:

- `frontend/.env.local` → `NEXT_PUBLIC_PROGRAM_ID`
- `frontend/idl/health_record.json` → top-level `"address"` (must match deployment)

Also refresh the IDL if you change the program:

```bash
cp target/idl/health_record.json ../frontend/idl/health_record.json
# Then re-set "address" in the JSON to your program id if the copy overwrote it.
```

## Run backend locally (optional)

The frontend does not need the backend. It exists for verifiers that cannot run SnarkJS themselves.

```bash
cd backend
cp ../.env.example .env   # edit: CIRCUIT_BUILD_DIR, CORS_ORIGIN
npm run dev
# POST http://localhost:4000/verify-proof   body: { proof, publicSignals }
# GET  http://localhost:4000/health
```

Production-style:

```bash
npm run build && npm start
```

## Run frontend locally

```bash
cd frontend
cp ../.env.example ./.env.local   # fill NEXT_PUBLIC_* and PINATA_JWT
npm run dev
# open http://localhost:3000
```

## Demo flow

1. Start the **frontend**; set env vars (program id, `PINATA_JWT`).
2. Connect **Phantom** (Devnet).
3. Adjust the sample record if you like; set a **passphrase**.
4. **Encrypt → IPFS → Solana**: confirm the Phantom transaction; note the **record account**.
5. In **Verifier: check a proof**, press **New challenge** (this also fills the owner's form).
6. In **Owner: prove**, press **Generate proof**, then **Copy into verifier form below**.
7. Press **Verify proof**: expect "Accepted". Change the challenge or the threshold and verify again: expect a specific rejection.

To try the verifier panel without a wallet, run `node anchor/tests/e2e-fixture.mjs` (starts a local validator with one record and prints a proof package) and start the frontend with `NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:18899`.

Sample JSON and ZK scenarios: [docs/SAMPLE_DATA.md](docs/SAMPLE_DATA.md).

## Tests

```bash
cd circuits && npm test    # circuit: 11 tests
cd ../anchor && npm test   # program on a local validator: 6 tests
cd ../frontend && npm test # proving/verifying helpers: 11 tests
```

## Benchmarks

Each script writes a JSON file to `bench/results/`. The paper's tables are generated from those files.

```bash
node bench/env.mjs                         # machine and tool versions
cd circuits && node bench/circuit.mjs      # constraints, sizes, prove/verify time
node bench/constraints.mjs                 # constraint count by simplification level
cd .. && node bench/crypto.mjs             # PBKDF2 + AES-GCM time by record size
cd anchor && node bench/chain.mjs          # account size, rent, compute units (local validator)
```

For in-browser timings, open `/bench` in the running frontend and press **Run**.

## Paper

`paper/` holds the journal paper. `paper/build.sh` regenerates the tables from `bench/results/` and builds two PDFs with [tectonic](https://tectonic-typesetting.github.io): `paper-ieee.pdf` (IEEE journal layout) and `paper-springer.pdf` (Springer Nature layout). `paper/references-verified.md` records where each reference was checked.

## Deployment (Vercel + Render, free tier sketch)

### Frontend (Vercel)

- Root directory: `frontend`
- Build: `npm run build`
- Output: Next.js default
- Env: all `NEXT_PUBLIC_*` variables, plus **`PINATA_JWT`** (server-side; used by `pages/api/pin-to-ipfs.ts`); set `NEXT_PUBLIC_API_URL` to your Render URL

### Backend (Render)

- Root directory: `backend`
- Build command (example; **circom must be available** or you **upload pre-built** `circuits/build`):

  ```bash
  cd ../circuits && npm ci && npm run compile && bash scripts/full-build.sh && cd ../backend && npm ci && npm run build
  ```

  Many students **build circuits on their laptop**, commit `circuits/build` artifacts (wasm, `circuit_final.zkey`, `verification_key.json`, excluding large `pot*.ptau` if desired), and use:

  ```bash
  npm ci && npm run build
  ```

- Start: `npm start`
- Env: `CORS_ORIGIN=https://your-app.vercel.app`, `CIRCUIT_BUILD_DIR` pointing to a directory that contains `verification_key.json`.

Render does not include **circom** by default—plan on **pre-built** circuit outputs for the simplest path.

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| Phantom “wrong network” | Phantom → Devnet; `NEXT_PUBLIC_SOLANA_NETWORK=devnet`. |
| `Program account not found` | Wrong `NEXT_PUBLIC_PROGRAM_ID` or program not deployed to Devnet. |
| Anchor instruction errors | IDL out of date: copy from `anchor/target/idl/`, fix `address`, rebuild frontend. |
| `503 Verification key missing` | Run `circuits` build; check `CIRCUIT_BUILD_DIR` on the backend. |
| Proof generation fails in the browser | Run `npm run copy-zk` in `frontend/` after building the circuit. |
| "This record has no salt" | The record was uploaded before commitments existed. Upload it again. |
| IPFS upload fails | `PINATA_JWT` missing or expired; JWT must allow pinning. Check Pinata dashboard and API route logs. |
| CORS errors | `CORS_ORIGIN` must match the exact browser origin (Vercel URL or `http://localhost:3000`). |
| TypeScript / React peer warnings | Use Node ≥ 20.18; run installs inside `frontend` and `backend` separately. |

## Scripts from repo root (optional)

```bash
npm run build:circuits   # cd circuits && npm run build
npm run anchor:build     # cd anchor && anchor build
npm run backend:dev      # cd backend && npm run dev
npm run frontend:dev     # cd frontend && npm run dev
```

## License

MIT (typical for coursework—adjust if your school requires otherwise).
