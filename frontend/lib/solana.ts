import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  Idl,
  Program,
  type Wallet,
} from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idlJson from "../idl/health_record.json";

export function getProgramId(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_PROGRAM_ID;
  if (!raw) {
    throw new Error("NEXT_PUBLIC_PROGRAM_ID is not set");
  }
  return new PublicKey(raw);
}

export function healthRecordPda(
  owner: PublicKey,
  timestamp: bigint,
  programId: PublicKey
): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(timestamp));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("record"), owner.toBuffer(), buf],
    programId
  );
  return pda;
}

function asAnchorWallet(wallet: WalletContextState): Wallet {
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
    throw new Error("Wallet not connected");
  }
  return wallet as unknown as Wallet;
}

export function getProgram(connection: Connection, wallet: WalletContextState) {
  const provider = new AnchorProvider(
    connection,
    asAnchorWallet(wallet),
    { commitment: "confirmed" }
  );
  const programId = getProgramId();
  const idl = { ...(idlJson as Idl), address: programId.toBase58() };
  return new Program(idl, provider);
}

export async function storeCidOnChain(
  connection: Connection,
  wallet: WalletContextState,
  cid: string
): Promise<{ signature: string; usedInit: boolean; timestamp: number; account: string }> {
  const program = getProgram(connection, wallet);
  const owner = wallet.publicKey!;
  const programId = getProgramId();
  // Use millisecond timestamp for uniqueness (seed + stored value).
  const timestamp = Date.now();
  const tsBig = BigInt(timestamp);
  const pda = healthRecordPda(owner, tsBig, programId);

  const sig = await program.methods
    .initRecord(new BN(timestamp), cid)
    .accounts({
      owner,
      healthRecord: pda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { signature: sig, usedInit: true, timestamp, account: pda.toBase58() };
}

type DecodedHealth = {
  owner: PublicKey;
  ipfsCid?: string;
  ipfs_cid?: string;
  timestamp?: BN;
};

export async function fetchOnChainCid(
  connection: Connection,
  owner: PublicKey
): Promise<{ cid: string; timestamp: BN } | null> {
  const programId = getProgramId();
  const coder = new BorshAccountsCoder(idlJson as Idl);
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      {
        memcmp: {
          offset: 8, // discriminator
          bytes: owner.toBase58(),
        },
      },
    ],
  });

  let best: { cid: string; timestamp: BN } | null = null;
  for (const a of accounts) {
    try {
      const rec = coder.decode("HealthRecord", a.account.data) as DecodedHealth;
      const cid = rec.ipfsCid ?? rec.ipfs_cid;
      const ts = rec.timestamp;
      if (!cid || ts === undefined) continue;
      if (!best || ts.gt(best.timestamp)) best = { cid, timestamp: ts };
    } catch {
      // ignore
    }
  }
  return best;
}
