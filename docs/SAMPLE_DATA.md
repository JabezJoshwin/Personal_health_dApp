# Sample data for the demo

Use these values in the UI or as JSON when explaining the project.

## Health record (plaintext before encryption)

```json
{
  "name": "Alex Student",
  "age": 21,
  "bloodGroup": "O+",
  "vaccinationCount": 3,
  "vaccines": ["Influenza 2025", "Tdap", "COVID-19 booster"],
  "testReports": ["CBC — normal", "Lipid panel — pending"]
}
```

## ZK scenario

- **Threshold (public):** `2` (hard-coded in the UI as `DEMO_THRESHOLD`; sent to `/generate-proof`).
- **Expected result:** With `vaccinationCount: 3`, the circuit sets `valid = 1` and Groth16 verification succeeds.

## Negative check (optional)

- Set `vaccinationCount` to `1` with threshold `2` → expect `verified: false` and `valid` in public signals `0`.

## Passphrase

- Any string works for AES (e.g. `demo-passphrase-change-me`). Losing it means the IPFS blob cannot be decrypted.
