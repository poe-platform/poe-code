import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const operation = process.argv[2];
const manifest = path.join(packageDirectory, "Cargo.toml");
const targetDirectory = path.resolve(packageDirectory, "../../out/rust-mcp-target");
const commands = {
  build: [["build", "--release", "--locked", "--manifest-path", manifest]],
  test: [["test", "--locked", "--manifest-path", manifest]],
  lint: [
    ["fmt", "--manifest-path", manifest, "--", "--check"],
    ["clippy", "--locked", "--manifest-path", manifest, "--all-targets", "--", "-D", "warnings"]
  ]
};

if (!Object.hasOwn(commands, operation)) {
  throw new Error("Expected a Rust package operation: build, test, or lint.");
}

for (const args of commands[operation]) {
  const result = spawnSync("cargo", args, {
    cwd: packageDirectory,
    env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.signal) throw new Error(`cargo was interrupted by ${result.signal}`);
    process.exit(result.status ?? 1);
  }
}
