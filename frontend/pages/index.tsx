import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { encryptJson } from "@/lib/crypto";
import { uploadEncryptedJson } from "@/lib/ipfs";
import {
  fetchRecord,
  fetchRecordsByOwner,
  getProgramId,
  storeCidOnChain,
} from "@/lib/solana";
import type { HealthRecordPayload } from "@/lib/types";
import {
  DEFAULT_ARTIFACTS,
  bytesToCommitment,
  checkDisclosure,
  commitmentToBytes,
  computeCommitment,
  parseCount,
  parseFieldElement,
  proveThreshold,
  randomFieldElement,
  type DisclosureCheck,
  type DisclosurePackage,
} from "@/lib/zk";

const defaultRecord: HealthRecordPayload = {
  name: "Alex Student",
  age: 21,
  bloodGroup: "O+",
  vaccinationCount: 3,
  vaccines: ["Influenza 2025", "Tdap", "COVID-19 booster"],
  testReports: ["CBC — normal", "Lipid panel — pending"],
};

const DEFAULT_THRESHOLD = 2;

/** What the owner's browser remembers about the record it just uploaded. */
type UploadedRecord = { address: string; vaccinationCount: number; salt: bigint };

const REJECTION_TEXT: Record<string, string> = {
  "commitment mismatch": "The proof is about a different record than the one at this address.",
  "threshold mismatch": "The proof was made for a different threshold than the one you asked for.",
  "challenge mismatch": "The proof was made for a different challenge. It may be a replay.",
  "invalid proof": "The proof is not cryptographically valid.",
  "claim not satisfied": "The proof is valid, but it shows the count is below the threshold.",
  "malformed public signals": "The proof package is malformed.",
};

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
  const [uploaded, setUploaded] = useState<UploadedRecord | null>(null);
  const [proofStatus, setProofStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [proofError, setProofError] = useState<string | null>(null);
  const [proveThresholdText, setProveThresholdText] = useState(String(DEFAULT_THRESHOLD));
  const [proveChallengeText, setProveChallengeText] = useState("");
  const [proofPackage, setProofPackage] = useState<DisclosurePackage | null>(null);
  const [proofMs, setProofMs] = useState<number | null>(null);

  // Verifier's side. In real use this runs on the verifier's own device.
  const [verifyThresholdText, setVerifyThresholdText] = useState(String(DEFAULT_THRESHOLD));
  const [verifyChallengeText, setVerifyChallengeText] = useState("");
  const [verifyPackageText, setVerifyPackageText] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<DisclosureCheck | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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
    const [latest] = await fetchRecordsByOwner(connection, wallet.publicKey);
    if (latest) {
      setCid(latest.cid);
      setChainNote(
        `Latest on-chain record: ${latest.address}. Timestamp (unix ms): ${latest.timestamp.toString()}`
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
      const vaccinationCount = parseCount(record.vaccinationCount);
      // The salt hides the count inside the public commitment. It is stored
      // only inside the encrypted record.
      const salt = randomFieldElement();
      const normalized: HealthRecordPayload = {
        ...record,
        vaccinationCount,
        vaccines: parseCommaList(vaccinesText),
        testReports: parseCommaList(testReportsText),
        zkSalt: salt.toString(),
      };
      setRecord(normalized);
      const commitment = computeCommitment(vaccinationCount, salt);
      const encrypted = await encryptJson(normalized, passphrase);
      const newCid = await uploadEncryptedJson(encrypted);
      setCid(newCid);
      const { signature, account } = await storeCidOnChain(
        connection,
        wallet,
        newCid,
        commitmentToBytes(commitment)
      );
      setTxSig(signature);
      setUploaded({ address: account, vaccinationCount, salt });
      setProofPackage(null);
      setProofStatus("idle");
      setChainNote(`Created on-chain record account ${account} (init_record).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleProof = async () => {
    setProofError(null);
    setProofPackage(null);
    setProofMs(null);
    if (!uploaded) {
      setProofStatus("error");
      setProofError("Upload a record first. The proof must refer to an on-chain record.");
      return;
    }
    setProofStatus("loading");
    try {
      const threshold = parseCount(proveThresholdText);
      const challenge = parseFieldElement(proveChallengeText, "Challenge");
      const started = performance.now();
      // Runs entirely in this browser tab; the count and salt are not sent anywhere.
      const { proof, publicSignals } = await proveThreshold({
        vaccinationCount: uploaded.vaccinationCount,
        salt: uploaded.salt,
        threshold,
        challenge,
      });
      setProofMs(performance.now() - started);
      setProofPackage({ record: uploaded.address, proof, publicSignals });
      setProofStatus("done");
    } catch (e) {
      setProofStatus("error");
      setProofError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleNewChallenge = () => {
    const challenge = randomFieldElement().toString();
    setVerifyChallengeText(challenge);
    // Demo convenience: both roles share this page, so hand the challenge to
    // the owner's form as the verifier would over any channel.
    setProveChallengeText(challenge);
    setVerifyResult(null);
  };

  const handleVerify = async () => {
    setVerifyError(null);
    setVerifyResult(null);
    setVerifyBusy(true);
    try {
      const threshold = parseCount(verifyThresholdText);
      const challenge = parseFieldElement(verifyChallengeText, "Challenge");
      let pkg: DisclosurePackage;
      try {
        pkg = JSON.parse(verifyPackageText) as DisclosurePackage;
      } catch {
        throw new Error("The proof package is not valid JSON.");
      }
      if (typeof pkg?.record !== "string" || !Array.isArray(pkg.publicSignals)) {
        throw new Error("The proof package is missing its record address or public signals.");
      }
      // The commitment comes from the chain, never from the prover.
      const onChain = await fetchRecord(connection, pkg.record);
      if (!onChain) {
        throw new Error("No health record account exists at that address.");
      }
      const vkeyRes = await fetch(DEFAULT_ARTIFACTS.vkey);
      if (!vkeyRes.ok) throw new Error("Could not load the verification key.");
      const vkey = (await vkeyRes.json()) as unknown;
      setVerifyResult(
        await checkDisclosure({
          vkey,
          proof: pkg.proof,
          publicSignals: pkg.publicSignals,
          expected: {
            commitment: bytesToCommitment(onChain.commitment),
            threshold,
            challenge,
          },
        })
      );
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Personal Health Record (demo)</h1>
          <p className="sub">
            Client AES-GCM → Pinata (IPFS) → Solana Devnet metadata with a
            commitment. Zero-knowledge proof generated in this browser
            (Circom / SnarkJS).
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
            Refresh on-chain record
          </button>
        </div>
        {chainNote && <p className="note">{chainNote}</p>}
      </section>

      <section className="card">
        <h2>Sample health record</h2>
        <p className="small">
          Only <strong>vaccinationCount</strong> is used for the ZK claim
          (≥ threshold). The IPFS object is encrypted JSON of the full record.
          A salted commitment to the count is stored on-chain with the CID.
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
        <h2>Upload result</h2>
        {error && <p className="err">{error}</p>}
        <dl className="dl">
          <dt>IPFS CID</dt>
          <dd className="mono wrap">{cid ?? "—"}</dd>
          <dt>Record account</dt>
          <dd className="mono wrap">{uploaded?.address ?? "—"}</dd>
          <dt>Transaction signature</dt>
          <dd className="mono wrap">{txSig ?? "—"}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Owner: prove vaccinationCount ≥ threshold</h2>
        <p className="small">
          The proof is generated in this browser. The count and its salt never
          leave this device. The verifier supplies the threshold and a one-time
          challenge.
        </p>
        <div className="grid">
          <label>
            Threshold (from the verifier)
            <input
              type="number"
              min={0}
              value={proveThresholdText}
              onChange={(e) => setProveThresholdText(e.target.value)}
            />
          </label>
          <label>
            Challenge (from the verifier)
            <input
              className="mono"
              value={proveChallengeText}
              onChange={(e) => setProveChallengeText(e.target.value)}
              placeholder="Paste the verifier's challenge"
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            disabled={proofStatus === "loading" || !uploaded}
            onClick={handleProof}
          >
            {proofStatus === "loading" ? "Generating proof…" : "Generate proof"}
          </button>
        </div>
        {!uploaded && (
          <p className="note">Upload a record above to enable proving.</p>
        )}
        {proofError && <p className="err">{proofError}</p>}
        {proofPackage && (
          <>
            <p className="ok">
              Proof generated
              {proofMs !== null ? ` in ${Math.round(proofMs)} ms` : ""}. Send
              this package to the verifier.
            </p>
            <pre className="mono small-pre">
              {JSON.stringify(proofPackage, null, 2)}
            </pre>
            <div className="row">
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setVerifyPackageText(JSON.stringify(proofPackage, null, 2))
                }
              >
                Copy into verifier form below
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Verifier: check a proof</h2>
        <p className="small">
          The verifier chooses the threshold and a fresh challenge, reads the
          commitment from the record account on Solana, and checks the proof
          against all three. No wallet is needed.
        </p>
        <div className="grid">
          <label>
            Threshold required
            <input
              type="number"
              min={0}
              value={verifyThresholdText}
              onChange={(e) => setVerifyThresholdText(e.target.value)}
            />
          </label>
          <label>
            Challenge issued
            <input
              className="mono"
              value={verifyChallengeText}
              onChange={(e) => setVerifyChallengeText(e.target.value)}
              placeholder="Generate a new challenge"
            />
          </label>
          <label className="wide">
            Proof package from the owner
            <textarea
              className="mono"
              value={verifyPackageText}
              onChange={(e) => setVerifyPackageText(e.target.value)}
              placeholder='{"record": "...", "proof": {...}, "publicSignals": [...]}'
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            onClick={handleNewChallenge}
          >
            New challenge
          </button>
          <button
            type="button"
            className="btn"
            disabled={verifyBusy || !verifyPackageText.trim()}
            onClick={handleVerify}
          >
            {verifyBusy ? "Verifying…" : "Verify proof"}
          </button>
        </div>
        {verifyError && <p className="err">{verifyError}</p>}
        {verifyResult?.ok === true && (
          <p className="ok">
            Accepted: the record at this address has vaccinationCount ≥{" "}
            {verifyThresholdText}.
          </p>
        )}
        {verifyResult?.ok === false && (
          <p className="err">
            Rejected: {REJECTION_TEXT[verifyResult.reason] ?? verifyResult.reason}
          </p>
        )}
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
