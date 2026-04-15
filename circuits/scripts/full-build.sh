#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p build

R1CS="build/vaccination_threshold.r1cs"
WASM_DIR="build/vaccination_threshold_js"
WASM="${WASM_DIR}/vaccination_threshold.wasm"
ZKEY0="build/circuit_0000.zkey"
ZKEY_FINAL="build/circuit_final.zkey"
PTAU_FINAL="build/pot_final.ptau"
VKEY="build/verification_key.json"

if [[ ! -f "$R1CS" ]]; then
  echo "Run npm run compile first (missing $R1CS)"
  exit 1
fi

if [[ ! -f "$PTAU_FINAL" ]]; then
  echo "Generating powers of tau (phase 1) — one-time, ~1–2 min..."
  npx snarkjs powersoftau new bn128 14 "$ROOT/build/pot_0000.ptau" -v
  npx snarkjs powersoftau contribute "$ROOT/build/pot_0000.ptau" "$ROOT/build/pot_0001.ptau" --name="student" -v -e="random"
  npx snarkjs powersoftau prepare phase2 "$ROOT/build/pot_0001.ptau" "$PTAU_FINAL" -v
fi

echo "Groth16 setup..."
npx snarkjs groth16 setup "$R1CS" "$PTAU_FINAL" "$ZKEY0" -v
npx snarkjs zkey contribute "$ZKEY0" "$ZKEY_FINAL" --name="student" -v -e="random"
npx snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VKEY"

echo "Done."
echo "  wasm: $WASM"
echo "  zkey: $ZKEY_FINAL"
echo "  vkey: $VKEY"
