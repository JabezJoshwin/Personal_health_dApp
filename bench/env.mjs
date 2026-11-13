// Records the machine and tool versions the benchmarks ran on.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeResult } from "./stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function installedVersion(pkgDir, name) {
  try {
    const p = path.join(root, pkgDir, "node_modules", ...name.split("/"), "package.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).version;
  } catch {
    return null;
  }
}

const cpus = os.cpus();
writeResult("env.json", {
  recorded_at: new Date().toISOString(),
  os: { platform: os.platform(), release: os.release(), arch: os.arch(), product: sh("sw_vers -productVersion") },
  hardware: {
    model: sh("sysctl -n hw.model"),
    cpu: cpus[0]?.model ?? null,
    logical_cores: cpus.length,
    performance_cores: Number(sh("sysctl -n hw.perflevel0.physicalcpu")) || null,
    efficiency_cores: Number(sh("sysctl -n hw.perflevel1.physicalcpu")) || null,
    memory_gb: Math.round(os.totalmem() / 2 ** 30),
  },
  versions: {
    node: process.version,
    circom: sh("circom --version"),
    snarkjs: installedVersion("circuits", "snarkjs"),
    circomlib: installedVersion("circuits", "circomlib"),
    poseidon_lite: installedVersion("circuits", "poseidon-lite"),
    anchor_cli: sh("anchor --version"),
    anchor_lang: "0.30.1",
    anchor_js: installedVersion("anchor", "@coral-xyz/anchor"),
    solana_web3js: installedVersion("anchor", "@solana/web3.js"),
    solana_cli: sh("solana --version"),
    solana_test_validator: sh("solana-test-validator --version"),
    rustc: sh("rustc --version"),
  },
});
