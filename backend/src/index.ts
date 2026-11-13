import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { verifyProofHandler } from "./proof.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "512kb" }));

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

const circuitDir = path.resolve(
  process.env.CIRCUIT_BUILD_DIR ?? path.join(__dirname, "../../circuits/build")
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "phr-zk-backend" });
});

app.post("/verify-proof", verifyProofHandler({ circuitDir }));

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`Circuit build dir: ${circuitDir}`);
  const vkey = path.join(circuitDir, "verification_key.json");
  if (!fs.existsSync(vkey)) {
    console.warn(`Missing artifact (run circuits build): ${vkey}`);
  }
});
