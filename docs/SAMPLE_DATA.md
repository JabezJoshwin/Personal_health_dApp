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

- **Threshold (chosen by the verifier):** `2` by default in the UI.
- **Challenge (chosen by the verifier):** press **New challenge**.
- **Expected result:** with `vaccinationCount: 3`, the proof has `valid = 1` and the verifier panel shows "Accepted".

## Negative checks

- Upload a record with `vaccinationCount: 1`, prove with threshold `2` → the verifier panel shows that the count is below the threshold.
- Verify a genuine proof with a different challenge → rejected as a possible replay.
- Verify a genuine proof with a higher threshold → rejected as made for a different threshold.

## Passphrase

- Any string works for AES (e.g. `demo-passphrase-change-me`). Losing it means the IPFS blob cannot be decrypted.
