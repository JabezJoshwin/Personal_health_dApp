# Decentralized Personal Health Record (Solana + IPFS + ZK demo)

College-scale MVP: **encrypted** health JSON on **IPFS (Pinata)**, **metadata (CID) on Solana Devnet** via **Anchor**, and a **single Circom/SnarkJS** claim proving `vaccinationCount >= threshold` with proof generation **off-chain** in a small **Express** server. **Phantom** is used through the **Solana wallet adapter**. No custom token, no on-chain ZK verification, Devnet only.

## Repository layout

```
personalHealth-dApp/
├── frontend/          # Next.js (pages router) + React + TypeScript
├── backend/           # Express + TypeScript + SnarkJS
├── anchor/            # Anchor program (metadata only)
├── circuits/          # Circom + SnarkJS build scripts
├── docs/              # Architecture + sample data
├── .env.example
└── README.md
```

## Architecture (short)

- **Browser:** AES-GCM encrypt record → Next.js API route pins JSON to IPFS via **Pinata** → call `init_record` / `update_record` with the CID.
- **Chain:** PDA per wallet holds `owner`, `ipfs_cid`, `timestamp`.
- **Backend:** `POST /generate-proof` runs Groth16 prove + verify; artifacts live in `circuits/build/`.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How the ZK piece works (simple explanation)

Think of the circuit as a **locked arithmetic puzzle**: you prove you know a **secret number** (`vaccinationCount`) such that it is **at least** the **public threshold**, without putting the secret on-chain. The **proof** is a short object a verifier can check with the **verification key** and **public inputs** (`threshold` and `valid`). In this MVP, checking happens in the **Node backend** (and optionally in the browser later); the Solana program **does not** validate the proof—so this demonstrates the **idea** of selective disclosure, not a full privacy production stack.

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
npm run compile          # produces build/vaccination_threshold.r1cs + build/vaccination_threshold_js/
npm run build            # runs scripts/full-build.sh → pot_final, circuit_final.zkey, verification_key.json
```

Artifacts expected by the backend:

- `circuits/build/vaccination_threshold_js/vaccination_threshold.wasm`
- `circuits/build/circuit_final.zkey`
- `circuits/build/verification_key.json`

The first run downloads/generates a **powers-of-tau** file under `circuits/build/` (can take a minute or two).

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

Copy the program id into:

- `frontend/.env.local` → `NEXT_PUBLIC_PROGRAM_ID`
- `frontend/idl/health_record.json` → top-level `"address"` (must match deployment)

Also refresh the IDL if you change the program:

```bash
cp target/idl/health_record.json ../frontend/idl/health_record.json
# Then re-set "address" in the JSON to your program id if the copy overwrote it.
```

## Run backend locally

```bash
cd backend
cp ../.env.example .env   # edit: CIRCUIT_BUILD_DIR, CORS_ORIGIN
npm run dev
# POST http://localhost:4000/generate-proof
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

1. Start **backend** and **frontend**; set env vars (program id, API URL, `PINATA_JWT`).
2. Connect **Phantom** (Devnet).
3. Adjust the sample record if you like; set a **passphrase**.
4. **Encrypt → IPFS → Solana**: confirm Phantom transactions; note **CID** and **signature**.
5. **Generate proof** (threshold `2` in the UI): observe **proof status**, **public signals**, and **verified**.

Sample JSON and ZK scenarios: [docs/SAMPLE_DATA.md](docs/SAMPLE_DATA.md).

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
- Env: `CORS_ORIGIN=https://your-app.vercel.app`, `CIRCUIT_BUILD_DIR` pointing to `circuits/build` if you vendor artifacts into the backend deploy bundle (e.g. copy into `backend/circuit-artifacts` and set `CIRCUIT_BUILD_DIR=./circuit-artifacts`).

Render does not include **circom** by default—plan on **pre-built** circuit outputs for the simplest path.

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| Phantom “wrong network” | Phantom → Devnet; `NEXT_PUBLIC_SOLANA_NETWORK=devnet`. |
| `Program account not found` | Wrong `NEXT_PUBLIC_PROGRAM_ID` or program not deployed to Devnet. |
| Anchor instruction errors | IDL out of date: copy from `anchor/target/idl/`, fix `address`, rebuild frontend. |
| `503 Circuit artifacts missing` | Run `circuits` build; check `CIRCUIT_BUILD_DIR` on the backend. |
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
