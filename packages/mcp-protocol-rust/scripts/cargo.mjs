import { spawnSync } from "node:child_process";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = process.env.npm_package_json
  ? path.dirname(process.env.npm_package_json)
  : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const operation = process.argv[2];
const manifest = path.join(packageDirectory, "Cargo.toml");
function resolveTargetDirectory() {
  if (process.env.CARGO_TARGET_DIR) return path.resolve(process.env.CARGO_TARGET_DIR);
  if (process.env.CI) return path.resolve(packageDirectory, "../../out/rust-mcp-target");
  const preferred = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "poe-code", "rust-mcp-target");
  try {
    mkdirSync(preferred, { recursive: true });
    accessSync(preferred, constants.W_OK);
    return preferred;
  } catch {
    return path.join(os.tmpdir(), "poe-code", "rust-mcp-target");
  }
}
const targetDirectory = resolveTargetDirectory();
const bindingManifest = path.join(packageDirectory, "bindings/Cargo.toml");
const commands = {
  build: [["build", "--release", "--locked", "--manifest-path", manifest]],
  test: [["test", "--locked", "--manifest-path", manifest]],
  lint: [
    ["fmt", "--manifest-path", manifest, "--", "--check"],
    ["clippy", "--locked", "--manifest-path", manifest, "--all-targets", "--", "-D", "warnings"],
    ["fmt", "--manifest-path", bindingManifest, "--", "--check"],
    [
      "clippy",
      "--locked",
      "--manifest-path",
      bindingManifest,
      "--all-targets",
      "--",
      "-D",
      "warnings"
    ]
  ]
};

if (!Object.hasOwn(commands, operation)) {
  throw new Error("Expected a Rust package operation: build, test, or lint.");
}

function run(command, args) {
  const result = spawnSync(command, args, {
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

if (operation !== "build" || !existsSync(bindingManifest)) {
  for (const args of commands[operation]) run("cargo", args);
}

if ((operation === "build" || operation === "test") && existsSync(bindingManifest)) {
  const output = path.join(packageDirectory, "dist");
  const hasPrebuiltBinding =
    operation === "test" &&
    existsSync(output) &&
    readdirSync(output).some((name) => name.endsWith(".node")) &&
    existsSync(path.join(output, "index.js")) &&
    existsSync(path.join(output, "index.d.ts"));
  if (!hasPrebuiltBinding) {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve("@napi-rs/cli/package.json")), "dist/cli.js");
    mkdirSync(output, { recursive: true });
    run(process.execPath, [
      cli,
      "build",
      "--cwd",
      packageDirectory,
      "--manifest-path",
      bindingManifest,
      "--target-dir",
      targetDirectory,
      "--output-dir",
      output,
      "--no-js",
      "--dts",
      existsSync(path.join(packageDirectory, "src/index.d.ts")) ? "native.d.ts" : "index.d.ts",
      "--release",
      "--",
      "--locked"
    ]);
    for (const name of readdirSync(path.join(packageDirectory, "src"))) {
      if (name.endsWith(".js"))
        copyFileSync(path.join(packageDirectory, "src", name), path.join(output, name));
    }
    if (existsSync(path.join(packageDirectory, "src/index.d.ts"))) {
      copyFileSync(path.join(packageDirectory, "src/index.d.ts"), path.join(output, "index.d.ts"));
    }
  }
  if (operation === "test") {
    const tests = readdirSync(path.join(packageDirectory, "tests"))
      .filter((name) => name.endsWith(".test.mjs"))
      .map((name) => path.join("tests", name));
    run(process.execPath, ["--test", ...tests]);
  }
}
