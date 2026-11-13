// On-chain cost benchmark, run against a throwaway local
// solana-test-validator (not Devnet): account size, rent-exempt deposit,
// transaction size, compute units and fee for init_record.
//
// Usage: node bench/chain.mjs [runs]   (default 20)
import {
  fundedKeypair,
  initRecordBuilder,
  programFor,
  recordPda,
  startValidator,
} from "../tests/localnet.mjs";
import { summarize, writeResult } from "../../bench/stats.mjs";

const RUNS = Number(process.argv[2] ?? 20);
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy"; // 59-char CIDv1
const COMMITMENT = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const V1_ACCOUNT_BYTES = 8 + 32 + (4 + 128) + 8; // layout before the commitment was added

const validator = await startValidator();
try {
  const { connection } = validator;
  const owner = await fundedKeypair(connection, 10);
  const program = programFor(connection, owner);

  const txBytes = [];
  const computeUnits = [];
  const fees = [];
  const confirmMs = [];
  let accountBytes = null;
  let ownerDebit = null;

  for (let i = 0; i < RUNS; i++) {
    const timestamp = BigInt(1_800_000_000_000 + i);
    const builder = initRecordBuilder(program, owner.publicKey, timestamp, CID, COMMITMENT);

    const tx = await builder.transaction();
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = owner.publicKey;
    tx.sign(owner);
    const raw = tx.serialize();
    txBytes.push(raw.length);

    const before = await connection.getBalance(owner.publicKey);
    const t0 = performance.now();
    const sig = await connection.sendRawTransaction(raw);
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    confirmMs.push(performance.now() - t0);

    const meta = (
      await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    ).meta;
    computeUnits.push(meta.computeUnitsConsumed);
    fees.push(meta.fee);

    if (i === 0) {
      const info = await connection.getAccountInfo(recordPda(owner.publicKey, timestamp));
      accountBytes = info.data.length;
      ownerDebit = before - (await connection.getBalance(owner.publicKey));
    }
  }

  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  const rent = await connection.getMinimumBalanceForRentExemption(accountBytes);
  const rentV1 = await connection.getMinimumBalanceForRentExemption(V1_ACCOUNT_BYTES);

  writeResult("chain.json", {
    recorded_at: new Date().toISOString(),
    runs: RUNS,
    environment: "local solana-test-validator with the program preloaded; not Devnet or Mainnet",
    cid_length_chars: CID.length,
    account: {
      bytes: accountBytes,
      rent_exempt_lamports: rent,
      rent_exempt_sol: rent / 1e9,
      v1_bytes: V1_ACCOUNT_BYTES,
      v1_rent_exempt_lamports: rentV1,
      v1_rent_exempt_sol: rentV1 / 1e9,
    },
    init_record: {
      transaction_bytes: uniq(txBytes),
      transaction_size_limit_bytes: 1232,
      compute_units: { min: Math.min(...computeUnits), max: Math.max(...computeUnits), distinct: uniq(computeUnits) },
      fee_lamports: uniq(fees),
      owner_debit_lamports_first_tx: ownerDebit,
    },
    local_confirmation: {
      note: "Time from send to 'confirmed' on the local validator. Indicative only; public cluster latency was not measured.",
      ...summarize(confirmMs),
    },
  });
} finally {
  await validator.stop();
}
process.exit(0);
