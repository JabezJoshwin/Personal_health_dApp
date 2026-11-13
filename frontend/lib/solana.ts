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
  cid: string,
  commitment: Uint8Array
): Promise<{ signature: string; timestamp: number; account: string }> {
  if (commitment.length !== 32) {
    throw new Error("Commitment must be 32 bytes.");
  }
  const program = getProgram(connection, wallet);
  const owner = wallet.publicKey!;
  const programId = getProgramId();
  // Use millisecond timestamp for uniqueness (seed + stored value).
  const timestamp = Date.now();
  const pda = healthRecordPda(owner, BigInt(timestamp), programId);

  const sig = await program.methods
    .initRecord(new BN(timestamp), cid, Array.from(commitment))
    .accounts({
      owner,
      healthRecord: pda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { signature: sig, timestamp, account: pda.toBase58() };
}

export type OnChainRecord = {
  address: string;
  owner: string;
  cid: string;
  timestamp: BN;
  /** Poseidon(vaccinationCount, salt), 32 bytes big-endian. */
  commitment: Uint8Array;
};

type DecodedHealth = {
  owner: PublicKey;
  ipfsCid?: string;
  ipfs_cid?: string;
  timestamp?: BN;
  commitment?: number[];
};

const accountsCoder = new BorshAccountsCoder(idlJson as Idl);

/** Returns null for anything that is not a current-layout HealthRecord account. */
export function decodeRecord(address: PublicKey, data: Buffer): OnChainRecord | null {
  try {
    const rec = accountsCoder.decode("HealthRecord", data) as DecodedHealth;
    const cid = rec.ipfsCid ?? rec.ipfs_cid;
    if (!cid || rec.timestamp === undefined || rec.commitment?.length !== 32) return null;
    return {
      address: address.toBase58(),
      owner: rec.owner.toBase58(),
      cid,
      timestamp: rec.timestamp,
      commitment: Uint8Array.from(rec.commitment),
    };
  } catch {
    return null;
  }
}

/** Reads one record by its account address. Needs no wallet: any verifier can call it. */
export async function fetchRecord(
  connection: Connection,
  address: string
): Promise<OnChainRecord | null> {
  let key: PublicKey;
  try {
    key = new PublicKey(address.trim());
  } catch {
    throw new Error("That is not a valid Solana address.");
  }
  const info = await connection.getAccountInfo(key);
  if (!info || !info.owner.equals(getProgramId())) return null;
  return decodeRecord(key, info.data);
}

/** All records owned by a wallet, newest first. */
export async function fetchRecordsByOwner(
  connection: Connection,
  owner: PublicKey
): Promise<OnChainRecord[]> {
  const accounts = await connection.getProgramAccounts(getProgramId(), {
    filters: [{ memcmp: { offset: 8 /* discriminator */, bytes: owner.toBase58() } }],
  });
  const out: OnChainRecord[] = [];
  for (const a of accounts) {
    const rec = decodeRecord(a.pubkey, a.account.data);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => (b.timestamp.gt(a.timestamp) ? 1 : b.timestamp.lt(a.timestamp) ? -1 : 0));
  return out;
}
