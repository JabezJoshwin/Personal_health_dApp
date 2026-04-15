import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { encryptJson } from "@/lib/crypto";
import { uploadEncryptedJson } from "@/lib/ipfs";
import {
  fetchOnChainCid,
  getProgramId,
  storeCidOnChain,
} from "@/lib/solana";
import type { HealthRecordPayload, ProofApiResponse } from "@/lib/types";

const defaultRecord: HealthRecordPayload = {
  name: "Alex Student",
  age: 21,
  bloodGroup: "O+",
  vaccinationCount: 3,
  vaccines: ["Influenza 2025", "Tdap", "COVID-19 booster"],
  testReports: ["CBC — normal", "Lipid panel — pending"],
};

const DEMO_THRESHOLD = 2;

function parseCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [record, setRecord] = useState<HealthRecordPayload>(defaultRecord);
  const [vaccinesText, setVaccinesText] = useState(defaultRecord.vaccines.join(", "));
  const [testReportsText, setTestReportsText] = useState(
    defaultRecord.testReports.join(", ")
  );
  const [passphrase, setPassphrase] = useState("demo-passphrase-change-me");
  const [cid, setCid] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainNote, setChainNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofStatus, setProofStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [proofResult, setProofResult] = useState<ProofApiResponse | null>(
    null
  );

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const programIdStr = useMemo(() => {
    try {
      return getProgramId().toBase58();
    } catch {
      return "(set NEXT_PUBLIC_PROGRAM_ID)";
    }
  }, []);

  const refreshChain = useCallback(async () => {
    if (!wallet.publicKey) {
      setChainNote(null);
      return;
    }
    const onChain = await fetchOnChainCid(connection, wallet.publicKey);
    if (onChain) {
      setCid(onChain.cid);
      setChainNote(
        `On-chain CID (slot confirmed). Timestamp (unix): ${onChain.timestamp.toString()}`
      );
    } else {
      setChainNote("No on-chain record for this wallet yet.");
    }
  }, [connection, wallet.publicKey]);

  const handleEncryptUploadChain = async () => {
    setError(null);
    setBusy("encrypt-upload-chain");
    setTxSig(null);
    try {
      if (!wallet.publicKey) throw new Error("Connect Phantom first.");
      const normalized: HealthRecordPayload = {
        ...record,
        vaccines: parseCommaList(vaccinesText),
        testReports: parseCommaList(testReportsText),
      };
      setRecord(normalized);
      const encrypted = await encryptJson(normalized, passphrase);
      const newCid = await uploadEncryptedJson(encrypted);
      setCid(newCid);
      const { signature } = await storeCidOnChain(
        connection,
        wallet,
        newCid
      );
      setTxSig(signature);
      setChainNote(
        "Created new on-chain metadata account (init_record)."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleProof = async () => {
    setError(null);
    setProofStatus("loading");
    setProofResult(null);
    try {
      const res = await fetch(`${apiUrl}/generate-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaccinationCount: record.vaccinationCount,
          threshold: DEMO_THRESHOLD,
        }),
      });
      const data = (await res.json()) as ProofApiResponse & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setProofStatus("error");
        setProofResult(data);
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setProofStatus("done");
      setProofResult(data);
    } catch (e) {
      setProofStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Personal Health Record (demo)</h1>
          <p className="sub">
            Client AES-GCM → Pinata (IPFS) → Solana Devnet metadata. ZK
            proof off-chain (Circom / SnarkJS).
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <section className="card">
        <h2>Wallet & program</h2>
        <p className="mono small">
          Cluster: {process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet"} · Program:{" "}
          {programIdStr}
        </p>
        <div className="row">
          <button type="button" className="btn secondary" onClick={refreshChain}>
            Refresh on-chain CID
          </button>
        </div>
        {chainNote && <p className="note">{chainNote}</p>}
      </section>

      <section className="card">
        <h2>Sample health record</h2>
        <p className="small">
          Only <strong>vaccinationCount</strong> is used for the ZK claim
          (≥ threshold). The IPFS object is encrypted JSON of the full record.
        </p>
        <div className="grid">
          <label>
            Name
            <input
              value={record.name}
              onChange={(e) => setRecord({ ...record, name: e.target.value })}
            />
          </label>
          <label>
            Age
            <input
              type="number"
              value={record.age}
              onChange={(e) =>
                setRecord({ ...record, age: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Blood group
            <input
              value={record.bloodGroup}
              onChange={(e) =>
                setRecord({ ...record, bloodGroup: e.target.value })
              }
            />
          </label>
          <label>
            Vaccination count (private for ZK)
            <input
              type="number"
              min={0}
              value={record.vaccinationCount}
              onChange={(e) =>
                setRecord({
                  ...record,
                  vaccinationCount: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="wide">
            Vaccines (comma-separated)
            <input
              value={vaccinesText}
              onChange={(e) => setVaccinesText(e.target.value)}
              onBlur={() =>
                setRecord((prev) => ({ ...prev, vaccines: parseCommaList(vaccinesText) }))
              }
            />
          </label>
          <label className="wide">
            Test reports (comma-separated)
            <input
              value={testReportsText}
              onChange={(e) => setTestReportsText(e.target.value)}
              onBlur={() =>
                setRecord((prev) => ({
                  ...prev,
                  testReports: parseCommaList(testReportsText),
                }))
              }
            />
          </label>
          <label className="wide">
            Encryption passphrase (client-side only)
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={!!busy || !wallet.publicKey}
            onClick={handleEncryptUploadChain}
          >
            {busy === "encrypt-upload-chain"
              ? "Working…"
              : "Encrypt → IPFS → Solana"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Zero-knowledge: vaccinationCount ≥ {DEMO_THRESHOLD}</h2>
        <p className="small">
          The backend runs SnarkJS Groth16 prove + verify using compiled circuit
          artifacts. The verifier learns the threshold and that the claim holds,
          not the exact count.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            disabled={proofStatus === "loading"}
            onClick={handleProof}
          >
            {proofStatus === "loading" ? "Generating proof…" : "Generate proof"}
          </button>
        </div>
        <p className="small">
          Proof status: <strong>{proofStatus}</strong>
        </p>
      </section>

      <section className="card">
        <h2>Results</h2>
        {error && <p className="err">{error}</p>}
        <dl className="dl">
          <dt>IPFS CID</dt>
          <dd className="mono wrap">{cid ?? "—"}</dd>
          <dt>Transaction signature</dt>
          <dd className="mono wrap">{txSig ?? "—"}</dd>
          <dt>Verification result</dt>
          <dd>
            {proofResult
              ? proofResult.verified
                ? "Verified (true)"
                : "Not verified / false"
              : "—"}
          </dd>
        </dl>
        {proofResult?.note && <p className="note">{proofResult.note}</p>}
        {proofResult?.publicSignals && (
          <details className="details">
            <summary>Public signals</summary>
            <pre className="mono">
              {JSON.stringify(proofResult.publicSignals, null, 2)}
            </pre>
          </details>
        )}
        {proofResult?.proof != null ? (
          <details className="details">
            <summary>Proof object</summary>
            <pre className="mono small-pre">
              {JSON.stringify(proofResult.proof, null, 2)}
            </pre>
          </details>
        ) : null}
      </section>

      <footer className="footer">
        <p>
          Devnet demo — do not use real PHI. Phantom + Pinata IPFS + Render/Vercel
          per README.
        </p>
      </footer>
    </div>
  );
}
