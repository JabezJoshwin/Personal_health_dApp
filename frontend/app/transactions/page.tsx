"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN, BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import idlJson from "../../idl/health_record.json";
import { getProgramId } from "@/lib/solana";
import { fetchEncryptedJson } from "@/lib/ipfs";
import { decryptJson } from "@/lib/crypto";
import type { EncryptedPayload } from "@/lib/encryptedPayload";
import type { ProofApiResponse } from "@/lib/types";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

type TxItem = {
  cid: string;
  timestamp: number;
  authority: string;
  accountAddress: string;
};

type DecodedHealthRecord = {
  owner: PublicKey;
  ipfsCid?: string;
  ipfs_cid?: string;
  timestamp?: BN;
};

function truncateMiddle(value: string, left = 6, right = 4) {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function formatTimestamp(ts: number) {
  // Program stores i64 unix seconds; fall back gracefully if it looks like ms.
  const ms = ts > 10_000_000_000 ? ts : ts * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function asFriendlyError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes("operationerror") || lower.includes("decrypt")) {
    return "Wrong passphrase (or corrupted payload).";
  }
  if (lower.includes("ipfs") || lower.includes("fetch")) {
    return "Failed to fetch record from IPFS.";
  }
  return msg;
}

export default function TransactionsPage() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [txs, setTxs] = useState<TxItem[]>([]);
  const [selected, setSelected] = useState<TxItem | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [decrypted, setDecrypted] = useState<unknown>(null);

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingDecrypt, setLoadingDecrypt] = useState(false);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coder = useMemo(() => new BorshAccountsCoder(idlJson as Idl), []);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const [zkByAccount, setZkByAccount] = useState<
    Record<
      string,
      | { status: "idle" | "loading" | "done" | "error"; verified?: boolean; message?: string }
      | undefined
    >
  >({});

  const fetchAccounts = useCallback(async () => {
    setError(null);
    setLoadingAccounts(true);
    try {
      const programId = getProgramId();
      const accounts = await connection.getProgramAccounts(programId, {
        ...(wallet.publicKey
          ? {
              filters: [
                {
                  memcmp: {
                    offset: 8, // discriminator
                    bytes: wallet.publicKey.toBase58(),
                  },
                },
              ],
            }
          : {}),
      });

      const decoded: TxItem[] = [];
      for (const { pubkey, account } of accounts) {
        try {
          const rec = coder.decode(
            "HealthRecord",
            account.data
          ) as DecodedHealthRecord;
          const cid = rec.ipfsCid ?? rec.ipfs_cid;
          const tsBn = rec.timestamp;
          if (!cid || !tsBn) continue;
          const timestamp = Number(tsBn.toString());
          decoded.push({
            cid,
            timestamp,
            authority: rec.owner.toBase58(),
            accountAddress: pubkey.toBase58(),
          });
        } catch {
          // Not a HealthRecord account (or decoding failed) — ignore.
        }
      }

      decoded.sort((a, b) => b.timestamp - a.timestamp);
      setTxs(decoded);
      if (decoded.length === 0) {
        setSelected(null);
        setDecrypted(null);
      } else if (selected) {
        // keep selection if still present
        const still = decoded.find((t) => t.accountAddress === selected.accountAddress);
        setSelected(still ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAccounts(false);
    }
  }, [coder, connection, selected, wallet.publicKey]);

  useEffect(() => {
    // Fetch once on mount.
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    async (item: TxItem) => {
      setError(null);
      setSelected(item);
      setDecrypted(null);

      const p = passphrase.trim();
      if (!p) {
        setError("Enter a passphrase to decrypt records.");
        return;
      }

      setLoadingDecrypt(true);
      try {
        const enc = (await fetchEncryptedJson(item.cid)) as EncryptedPayload;
        const plain = await decryptJson(enc, p);
        setDecrypted(plain);
      } catch (e) {
        setError(asFriendlyError(e));
      } finally {
        setLoadingDecrypt(false);
      }
    },
    [passphrase]
  );

  const verifyZkForItem = useCallback(
    async (item: TxItem) => {
      const p = passphrase.trim();
      if (!p) {
        setError("Enter a passphrase to decrypt records.");
        return;
      }

      setZkByAccount((prev) => ({
        ...prev,
        [item.accountAddress]: { status: "loading" },
      }));
      try {
        const enc = (await fetchEncryptedJson(item.cid)) as EncryptedPayload;
        const plain = (await decryptJson(enc, p)) as unknown;
        const vaccinationCountRaw = (plain as { vaccinationCount?: unknown })?.vaccinationCount;
        const vaccinationCount =
          typeof vaccinationCountRaw === "number"
            ? vaccinationCountRaw
            : typeof vaccinationCountRaw === "string"
              ? Number(vaccinationCountRaw)
              : NaN;

        if (!Number.isFinite(vaccinationCount) || vaccinationCount < 0) {
          setZkByAccount((prev) => ({
            ...prev,
            [item.accountAddress]: {
              status: "error",
              verified: false,
              message: "Record missing a valid vaccinationCount.",
            },
          }));
          return;
        }

        const res = await fetch(`${apiUrl}/generate-proof`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vaccinationCount,
            threshold: 2,
          }),
        });
        const data = (await res.json()) as ProofApiResponse & {
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          setZkByAccount((prev) => ({
            ...prev,
            [item.accountAddress]: {
              status: "error",
              verified: false,
              message: data.message ?? data.error ?? `HTTP ${res.status}`,
            },
          }));
          return;
        }
        setZkByAccount((prev) => ({
          ...prev,
          [item.accountAddress]: {
            status: "done",
            verified: !!data.verified,
            message: data.note,
          },
        }));
      } catch (e) {
        setZkByAccount((prev) => ({
          ...prev,
          [item.accountAddress]: {
            status: "error",
            verified: false,
            message: asFriendlyError(e),
          },
        }));
      }
    },
    [apiUrl, passphrase]
  );

  const verifyAll = useCallback(async () => {
    setError(null);
    const p = passphrase.trim();
    if (!p) {
      setError("Enter a passphrase to decrypt records.");
      return;
    }
    setVerifyingAll(true);
    try {
      for (const item of txs) {
        // eslint-disable-next-line no-await-in-loop
        await verifyZkForItem(item);
      }
    } finally {
      setVerifyingAll(false);
    }
  }, [passphrase, txs, verifyZkForItem]);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Transactions</h1>
          <p className="sub">
            On-chain HealthRecord accounts → click to fetch from IPFS and decrypt
            client-side.
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <section className="card">
        <h2>Decrypt settings</h2>
        <div className="grid">
          <label className="wide">
            Passphrase
            <input
              type="password"
              value={passphrase}
              placeholder="Enter the same passphrase used during encryption"
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            disabled={loadingAccounts}
            onClick={fetchAccounts}
          >
            {loadingAccounts ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={verifyingAll || txs.length === 0}
            onClick={() => void verifyAll()}
          >
            {verifyingAll ? "Verifying ZK…" : "Verify ZK for all"}
          </button>
          <p className="small" style={{ margin: 0, alignSelf: "center" }}>
            Records found: <strong>{txs.length}</strong>
          </p>
        </div>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="card">
        <h2>Stored records</h2>

        {loadingAccounts ? (
          <p className="note">Loading on-chain records…</p>
        ) : !wallet.publicKey ? (
          <p className="note">Connect your wallet to view your records.</p>
        ) : txs.length === 0 ? (
          <p className="note">
            No records found yet. Create one on the home page, then come back and
            hit Refresh.
          </p>
        ) : (
          <div className="txList" role="list">
            {txs.map((t) => {
              const isSelected = selected?.accountAddress === t.accountAddress;
              const zk = zkByAccount[t.accountAddress];
              return (
                <button
                  key={t.accountAddress}
                  type="button"
                  role="listitem"
                  className={`txItem ${isSelected ? "selected" : ""}`}
                  onClick={() => void handleSelect(t)}
                  disabled={loadingDecrypt && isSelected}
                >
                  <div className="txTop">
                    <div className="mono wrap">
                      <strong>CID:</strong> {truncateMiddle(t.cid, 12, 8)}
                    </div>
                    <div className="txTime">{formatTimestamp(t.timestamp)}</div>
                  </div>
                  <div className="txMeta">
                    <span className="mono">
                      <strong>Authority:</strong> {truncateMiddle(t.authority, 8, 6)}
                    </span>
                    <span className="mono">
                      <strong>Account:</strong> {truncateMiddle(t.accountAddress, 8, 6)}
                    </span>
                    <span className="mono">
                      <strong>ZK:</strong>{" "}
                      {zk?.status === "loading"
                        ? "checking…"
                        : zk?.status === "done"
                          ? zk.verified
                            ? "verified"
                            : "false"
                          : zk?.status === "error"
                            ? "error"
                            : "—"}
                    </span>
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void verifyZkForItem(t);
                      }}
                      disabled={zk?.status === "loading" || verifyingAll}
                    >
                      {zk?.status === "loading" ? "Verifying…" : "Verify ZK"}
                    </button>
                    {zk?.message ? (
                      <span className="small" style={{ alignSelf: "center" }}>
                        {zk.message}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Decrypted record</h2>
        {!selected ? (
          <p className="note">Select a record above to view it.</p>
        ) : loadingDecrypt ? (
          <p className="note">Fetching + decrypting…</p>
        ) : decrypted == null ? (
          <p className="note">
            Selected: <span className="mono">{truncateMiddle(selected.cid, 14, 10)}</span>
          </p>
        ) : (
          <>
            <p className="small">
              <strong>Selected CID:</strong>{" "}
              <span className="mono wrap">{selected.cid}</span>
            </p>
            <pre className="mono">{JSON.stringify(decrypted, null, 2)}</pre>
          </>
        )}
      </section>
    </div>
  );
}

