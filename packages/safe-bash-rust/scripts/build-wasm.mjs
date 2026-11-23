import { build } from "esbuild";
import { adapterBytes } from "../src/stream-adapter.js";
import { resolveCargoTargetDirectory } from "../../mcp-protocol-rust/scripts/cargo-target.mjs";
import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
for (const license of ["LICENSE.Liberation", "LICENSE.DejaVu", "LICENSE.NotoSansSC"]) {
  copyFileSync(path.join(pkgDir, "../pdf-ast-rust/src/fonts", license), path.join(distDir, license));
}
copyFileSync(path.join(pkgDir, "../terminal-png-rust/LICENSE.FONT"), path.join(distDir, "LICENSE.JetBrainsMono"));
copyFileSync(path.join(pkgDir, "LICENSE.WAVPACK"), path.join(distDir, "LICENSE.WAVPACK"));
copyFileSync(path.join(pkgDir, "LICENSE.EXR"), path.join(distDir, "LICENSE.EXR"));
copyFileSync(path.join(pkgDir, "LICENSE.AAC"), path.join(distDir, "LICENSE.AAC"));
copyFileSync(path.join(pkgDir, "LICENSE.AMR"), path.join(distDir, "LICENSE.AMR"));
copyFileSync(path.join(pkgDir, "LICENSE.GNUMERIC"), path.join(distDir, "LICENSE.GNUMERIC"));
copyFileSync(path.join(pkgDir, "LICENSE.GLIB"), path.join(distDir, "LICENSE.GLIB"));
for (const license of ["LICENSE.IronCalc", "LICENSE.Univer", "LICENSE.XlsxWriter", "LICENSE.OpenOffice", "NOTICE.OpenOffice", "LICENSE.Boost", "LICENSE.Sun", "LICENSE.LibreOffice", "LICENSE.ClosedXML"]) {
  copyFileSync(path.join(pkgDir, "src/commands/spreadsheet", license), path.join(distDir, license));
}
// LGPL recipients can rebuild and replace the linked Rust library, including
// its internal path dependencies, without access to this checkout.
const metadata = spawnSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], {cwd: pkgDir, encoding: "utf8"});
if (metadata.status !== 0) throw new Error(metadata.stderr || "Cargo source metadata failed");
const sourceDir = path.join(distDir, "rust-source");
rmSync(sourceDir, {recursive: true, force: true});
for (const pkg of JSON.parse(metadata.stdout).packages) {
  if (pkg.source !== null) throw new Error("Rust source distribution requires internal crates only");
  const from = path.dirname(pkg.manifest_path);
  const to = path.join(sourceDir, path.relative(repoRoot, from));
  mkdirSync(to, {recursive: true});
  for (const file of ["Cargo.toml", "Cargo.lock", "build.rs", "src", ...readdirSync(from).filter(name => name === "LICENSE" || name.startsWith("LICENSE."))]) {
    if (existsSync(path.join(from, file))) cpSync(path.join(from, file), path.join(to, file), {recursive: true});
  }
}
const ghDefaults = "packages/safe-bash-command-gh/src/config-defaults.json";
mkdirSync(path.dirname(path.join(sourceDir, ghDefaults)), {recursive: true});
copyFileSync(path.join(repoRoot, ghDefaults), path.join(sourceDir, ghDefaults));
