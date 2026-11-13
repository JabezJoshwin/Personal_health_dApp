# IEEE journal paper on the personal health record dApp — design

Date: 2026-11-13

## Intent

Produce a journal paper, in IEEE format, describing this dApp, with the aim of
acceptance in a Scopus-indexed journal. The authors are:

1. M. Jabez Joshwin Paul (first author), Div. of Computer Science and
   Engineering, Karunya Institute of Technology and Sciences, Coimbatore,
   Tamil Nadu, India — jabezjoshwin@gmail.com
2. Dr. E. Bijolin Edwin, Associate Professor, Dept. of Computer Science and
   Engineering, Karunya Institute of Technology and Sciences, Coimbatore,
   Tamil Nadu, India — no email given

The user's hard rule: nothing invented. Sources must be reputable, and every
factual claim must be traceable.

## Goals

- A complete, compilable paper (LaTeX source and PDF) that reviewers can take
  seriously: a clear contribution, a real evaluation, an honest threat model.
- A dApp whose privacy claim holds: the proving party is the patient's
  browser, and a proof is tied to the record stored on-chain.
- Every number in the paper reproducible from a script in this repo.
- Every reference checked against its publisher page or DOI.

## Non-goals

- Submitting the paper, creating journal accounts, or paying fees.
- Deploying to Devnet or pushing to GitHub (both use the user's keys).
- On-chain proof verification. It is discussed as future work only.
- New cryptography. The paper claims a system design and its evaluation.

## Anti-goals

- Any fabricated or estimated number presented as measured.
- Any reference that was not opened and checked.
- Claims of clinical deployment, regulatory compliance, or production
  readiness.
- Comparison figures against other systems unless quoted from their papers
  with a citation.

## Approaches considered

1. **Write about the dApp as it is.** No code changes; both privacy gaps are
   listed as limitations. Fastest, but the paper's central claim (selective
   disclosure) is undercut by its own limitations section.
2. **Close the two gaps, then write.** Chosen by the user. Proving moves to
   the browser, and the circuit publishes a commitment to the private value
   that is also stored on-chain, so a verifier can check that a proof refers
   to a specific stored record.
3. **Add on-chain Groth16 verification as well.** Rejected: a large change
   for a modest gain in this paper, and it would need a Devnet deployment to
   evaluate.
4. **Survey paper.** Rejected: the repo supports a system paper, not a
   survey.

## Target journal

My call (the user asked me to suggest one): **IEEE Access**.

- It uses IEEE format, which the user asked for.
- Its scope explicitly welcomes application-oriented work
  (ieeeaccess.ieee.org/about).
- Checked facts: binary accept/reject review, average acceptance rate 20 %,
  article processing charge USD 2,160 for 2026 submissions and USD 2,245 for
  2027 (open.ieee.org/for-authors/article-processing-charges).
- Scopus indexing is to be confirmed on the Scopus source list before the
  paper names it anywhere.

Fallback: Peer-to-Peer Networking and Applications (Springer). Its own page
lists Scopus and SCIE indexing and a 121-day median first decision; it is now
fully open access, so it also charges a fee.

The paper is written with the standard `IEEEtran` journal class so it
compiles anywhere. IEEE Access has its own submission template; the body
moves into it unchanged, and that port is left to the authors at submission
time.

## Code changes

### Circuit (`circuits/vaccination_threshold.circom`)

- New private input `salt`; new public input `challenge` (a verifier-chosen
  nonce, bound into the proof so a proof cannot be replayed to another
  verifier).
- New public output `commitment = Poseidon(vaccinationCount, salt)`.
- Explicit 32-bit range checks on `vaccinationCount` and `threshold`.
- `valid` stays a public output; the verifier requires `valid == 1`.
- Public signals, in order: `valid`, `commitment`, `threshold`, `challenge`.
- Trusted setup is re-run locally with the existing script. It is a
  single-party setup, and the paper says so.

Details I settled myself:

- `salt` and `challenge` are 31 random bytes each, so they are always below
  the BN254 field modulus.
- The commitment is stored on-chain as 32 bytes, big-endian.
- The circuit file keeps its name, so existing build scripts still work.

### Anchor program (`anchor/programs/health-record/src/lib.rs`)

- `init_record(timestamp, ipfs_cid, commitment: [u8; 32])`.
- `HealthRecord` gains `commitment: [u8; 32]`.
- IDL regenerated and copied to `frontend/idl/`.

### Frontend

- `snarkjs` runs in the browser; circuit artifacts are served from
  `frontend/public/zk/`.
- A random salt is generated per record and stored inside the encrypted
  record, so the owner can prove again later.
- The commitment is computed in the browser (`poseidon-lite`) and sent with
  `init_record`.
- A verifier panel: given a record address, a threshold, a challenge and a
  proof, it reads the commitment from the chain and accepts only if the proof
  verifies, `valid == 1`, and the commitment, threshold and challenge match.

### Backend

- `/generate-proof` is removed. `/verify-proof` takes a proof and public
  signals and returns the verification result. The backend never receives the
  private count.

### Docs and tests

- README and `docs/ARCHITECTURE.md` rewritten to match the code.
- Circuit tests (Node's built-in test runner): claim true, claim false,
  boundary, out-of-range input rejected, tampered proof rejected, commitment
  equals the `poseidon-lite` value.
- Program test against a local validator: record created, commitment stored,
  over-long CID rejected.

## Evaluation (all measured on this machine; hardware stated in the paper)

Scripts live in `bench/` and write JSON results that the paper's tables and
figures are generated from.

| Measurement | How |
|---|---|
| Constraints, wires, signals, for the old and new circuit | `snarkjs r1cs info` |
| Artifact and proof sizes | file sizes |
| Witness + proving time, verification time (Node) | repeated runs, median and spread |
| Proving time in a real browser | the app on localhost, repeated runs |
| Key derivation and encryption time vs record size | Web Crypto in Node |
| Account size, rent-exempt deposit, transaction size, compute units, fee | local `solana-test-validator` |

Not measured, and stated as such in the paper: Devnet confirmation latency
and IPFS pinning latency. Both need the user's wallet or Pinata key.

## Paper

- Location: `paper/` — `main.tex`, `refs.bib`, generated figures, a build
  script, and `references-verified.md` (one line per reference: where it was
  checked).
- Built with `tectonic`, installed through Homebrew.
- Working title: *Commitment-Bound Selective Disclosure for Patient-Held
  Health Records on Solana and IPFS*.
- Sections: Abstract; Index Terms; Introduction with contributions;
  Background; Related Work; System Design and Threat Model; Implementation;
  Evaluation; Security Analysis and Limitations; Conclusion; Acknowledgment;
  References.
- Length: about 8–10 two-column pages, roughly 30–40 references.
- Source rule: peer-reviewed papers from IEEE, ACM, Springer, Elsevier,
  USENIX or IACR venues; standards (NIST, IETF); and primary specifications
  or official documentation for the tools used. No blogs, no aggregator
  sites.
- The Acknowledgment discloses AI assistance, as IEEE requires for any
  submitted article: the system used, which sections, and to what level
  (open.ieee.org/author-guidelines-for-artificial-intelligence-ai-generated-text).
- Limitations stated plainly: the health data is self-asserted (no issuer
  signature), proofs are verified off-chain, the setup is single-party, the
  encryption key comes from a passphrase, and one claim type is supported.

## Left to the authors

- Read and check the whole paper; the authors are accountable for it.
- Redeploy the program to Devnet and update the program id.
- Revoke the Pinata key committed in `.env.example`.
- Port into the IEEE Access template, submit, and handle the fee.
