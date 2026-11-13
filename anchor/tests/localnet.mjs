// Helpers shared by the program test and the on-chain benchmark.
// Starts a throwaway solana-test-validator with the built program preloaded,
// so nothing touches Devnet or the developer's own wallet.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ANCHOR_DIR = path.join(here, "..");
export const IDL = JSON.parse(
  fs.readFileSync(path.join(ANCHOR_DIR, "target", "idl", "health_record.json"), "utf8")
);
export const PROGRAM_ID = new PublicKey(IDL.address);
const PROGRAM_SO = path.join(ANCHOR_DIR, "target", "deploy", "health_record.so");

export const RPC_PORT = 18899;
const FAUCET_PORT = 19900;
export const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;

export async function startValidator() {
  if (!fs.existsSync(PROGRAM_SO)) {
    throw new Error(`Missing ${PROGRAM_SO}; run "anchor build" first.`);
  }
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), "phr-ledger-"));
  const child = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger", ledger,
      "--rpc-port", String(RPC_PORT),
      "--faucet-port", String(FAUCET_PORT),
      "--bpf-program", PROGRAM_ID.toBase58(), PROGRAM_SO,
    ],
    { stdio: "ignore" }
  );
  const connection = new Connection(RPC_URL, "confirmed");
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await connection.getLatestBlockhash();
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill("SIGKILL");
        throw new Error("solana-test-validator did not start within 60 s");
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const stop = async () => {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    fs.rmSync(ledger, { recursive: true, force: true });
  };
  return { connection, stop };
}

export async function fundedKeypair(connection, sol = 2) {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  return kp;
}

export function programFor(connection, keypair) {
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  return new anchor.Program(IDL, provider);
}

export function recordPda(owner, timestamp) {
  const ts = Buffer.alloc(8);
  ts.writeBigInt64LE(BigInt(timestamp));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("record"), owner.toBuffer(), ts],
    PROGRAM_ID
  )[0];
}

export function initRecordBuilder(program, owner, timestamp, cid, commitment) {
  return program.methods
    .initRecord(new anchor.BN(timestamp.toString()), cid, Array.from(commitment))
    .accountsPartial({
      owner,
      healthRecord: recordPda(owner, timestamp),
    });
}
