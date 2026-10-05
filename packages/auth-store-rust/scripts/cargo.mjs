import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveCargoTargetDirectory } from "../../mcp-protocol-rust/scripts/cargo-target.mjs";
import path from "node:path";

const directory = fileURLToPath(new URL("..", import.meta.url));
const operation = process.argv[2];
const target = resolveCargoTargetDirectory(path.resolve(directory, "../.."));
const rustc = spawnSync("rustup", ["which", "--toolchain", "stable", "rustc"], { encoding: "utf8" });
if (rustc.error) throw rustc.error;
if (rustc.status !== 0) throw new Error(rustc.stderr);
const wasmEnvironment = { RUSTC: rustc.stdout.trim(), PATH: `${path.dirname(rustc.stdout.trim())}${path.delimiter}${process.env.PATH ?? ""}` };
function run(command, args, environment = {}) {
  const result = spawnSync(command, args, { cwd: directory, env: { ...process.env, CARGO_TARGET_DIR: target, ...environment }, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const installed = spawnSync("rustup", ["target", "list", "--installed", "--toolchain", "stable"], { encoding: "utf8" });
if (installed.error) throw installed.error;
if (installed.status !== 0) throw new Error(installed.stderr);
if (!installed.stdout.split(/\r?\n/).includes("wasm32-unknown-unknown")) {
  run("rustup", ["target", "add", "wasm32-unknown-unknown", "--toolchain", "stable"]);
}
if (operation === "build" || operation === "test") {
  run("rustup", ["run", "stable", "cargo", "build", "--release", "--locked", "--target", "wasm32-unknown-unknown"], wasmEnvironment);
  const output = new URL("../dist/", import.meta.url);
  mkdirSync(output, { recursive: true });
  const bytes = readFileSync(path.join(target, "wasm32-unknown-unknown/release/auth_store_rust.wasm"));
  writeFileSync(new URL("auth-store-rust.wasm", output), bytes);
  writeFileSync(new URL("portable-module.js", output), `const bytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}), c => c.charCodeAt(0));\nexport default new WebAssembly.Module(bytes);\n`);
  copyFileSync(new URL("../src/index.browser.d.ts", import.meta.url), new URL("index.browser.d.ts", output));
}
run(process.execPath, [fileURLToPath(new URL("../../mcp-protocol-rust/scripts/cargo.mjs", import.meta.url)), operation]);
if (operation === "lint") run("rustup", ["run", "stable", "cargo", "clippy", "--locked", "--target", "wasm32-unknown-unknown", "--", "-D", "warnings"], wasmEnvironment);
