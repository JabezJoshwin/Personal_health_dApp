/**
 * Pins encrypted JSON to IPFS through Pinata (server-side JWT in `/api/pin-to-ipfs`).
 */
export async function uploadEncryptedJson(payload: unknown): Promise<string> {
  const res = await fetch("/api/pin-to-ipfs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    cid?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.message ?? data.error ?? `Pinata upload failed (${res.status})`
    );
  }
  if (!data.cid) {
    throw new Error("Pinata response missing CID");
  }
  return data.cid;
}

export async function fetchEncryptedJson(cid: string): Promise<unknown> {
  const gateways = [
    `https://gateway.pinata.cloud/ipfs/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
  ];

  let lastErr: unknown = null;
  for (const url of gateways) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        lastErr = new Error(`IPFS fetch failed (${res.status})`);
        continue;
      }
      return (await res.json()) as unknown;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to fetch from IPFS gateways");
}
