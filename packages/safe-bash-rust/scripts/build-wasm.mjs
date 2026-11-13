import { build } from "esbuild";
import { adapterBytes } from "../src/stream-adapter.js";
import { resolveCargoTargetDirectory } from "../../mcp-protocol-rust/scripts/cargo-target.mjs";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
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
for (const file of ["index.js", "node-platform.js", "stream-adapter.js"]) {
  copyFileSync(path.join(pkgDir, "src", file), path.join(distDir, file));
}
writeFileSync(path.join(distDir, "stream-adapter.wasm"), adapterBytes);
await build({
  entryPoints: [path.join(pkgDir, "src/index.js")], outfile: path.join(distDir, "workerd.js"),
  bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", target: "es2022",
  external: ["*.wasm"],
});
await build({
  entryPoints: [path.join(pkgDir, "src/browser.js")], outfile: path.join(distDir, "browser.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2022",
});
for (const file of ["index.d.ts", "browser.d.ts"]) {
  copyFileSync(path.join(pkgDir, "src", file), path.join(distDir, file));
}
copyFileSync(path.join(pkgDir, "LICENSE.UNICODE"), path.join(distDir, "LICENSE.UNICODE"));
copyFileSync(path.join(pkgDir, "LICENSE.BZIP2"), path.join(distDir, "LICENSE.BZIP2"));
copyFileSync(path.join(pkgDir, "LICENSE.PDFJS"), path.join(distDir, "LICENSE.PDFJS"));
