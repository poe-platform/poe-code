import { resolveCargoTargetDirectory } from "../../mcp-protocol-rust/scripts/cargo-target.mjs";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(pkgDir, "../..");
const targetDir = resolveCargoTargetDirectory(repoRoot);
const manifest = path.join(pkgDir, "Cargo.toml");

const res = spawnSync(
  "cargo",
  [
    "build",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "--locked",
    "--manifest-path",
    manifest,
  ],
  {
    cwd: pkgDir,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: "inherit",
  },
);

if (res.status !== 0) {
  process.exit(res.status ?? 1);
}

const distDir = path.join(pkgDir, "dist");
mkdirSync(distDir, { recursive: true });
const wasmSrc = path.join(
  targetDir,
  "wasm32-unknown-unknown",
  "release",
  "safe_bash_rust.wasm",
);
copyFileSync(wasmSrc, path.join(distDir, "safe_bash_rust.wasm"));
copyFileSync(path.join(pkgDir, "src", "index.js"), path.join(distDir, "index.js"));
copyFileSync(path.join(pkgDir, "src", "index.d.ts"), path.join(distDir, "index.d.ts"));
