import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "512kb",
    },
  },
};

type PinataPinResponse = {
  IpfsHash?: string;
  error?: { reason?: string; details?: string } | string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt?.trim()) {
    return res.status(503).json({
      error: "Pinata not configured",
      message: "Set PINATA_JWT in frontend/.env.local (see .env.example).",
    });
  }

  const pinataContent = req.body;
  if (pinataContent === undefined || pinataContent === null) {
    return res.status(400).json({ error: "Expected JSON body" });
  }

  try {
    const pinataRes = await fetch(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt.trim()}`,
        },
        body: JSON.stringify({
          pinataContent,
          pinataOptions: { cidVersion: 1 },
          pinataMetadata: { name: "health-record.enc.json" },
        }),
      }
    );

    const data = (await pinataRes.json()) as PinataPinResponse;

    if (!pinataRes.ok) {
      const reason =
        typeof data.error === "object"
          ? data.error?.reason ?? JSON.stringify(data.error)
          : data.error ?? pinataRes.statusText;
      return res.status(502).json({
        error: "Pinata request failed",
        message: reason,
      });
    }

    const cid = data.IpfsHash;
    if (!cid) {
      return res.status(502).json({
        error: "Pinata response missing IpfsHash",
      });
    }

    return res.status(200).json({ cid });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: "Upload failed", message });
  }
}
