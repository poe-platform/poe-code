import { spawnSync } from "node:child_process";
import { runNativeTests } from "./run-native-tests.mjs";
import { copyNativeBinding } from "./native-binding.mjs";
import { createHash } from "node:crypto";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = process.env.npm_package_json
  ? path.dirname(process.env.npm_package_json)
  : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(packageDirectory, "../..");
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

function computeRustInputsState() {
  const packagesRoot = path.resolve(packageDirectory, "..");
  const hash = createHash("sha256").update(
    JSON.stringify({ platform: process.platform, arch: process.arch, abi: process.versions.modules, pkg: path.basename(packageDirectory) })
  );
  const extensions = [".rs", ".toml", ".lock", ".json", ".md", ".ttf", ".base64", ".txt"];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "target" || entry.name === "dist" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        hash.update(path.relative(packagesRoot, full) + "\0");
        hash.update(readFileSync(full));
      }
    }
  };
  if (existsSync(packagesRoot)) {
    for (const dirName of readdirSync(packagesRoot).sort()) {
      if (dirName.endsWith("-rust")) walk(path.join(packagesRoot, dirName));
    }
    walk(path.join(packagesRoot, "agent-defs", "src"));
    walk(path.join(packagesRoot, "poe-code-config", "src"));
  }
  return { digest: hash.digest("hex") };
}

function resolveNapiCacheDirectories() {
  const primary = process.env.POE_CHECK_CACHE_DIR
    ? path.join(path.dirname(path.resolve(repoRoot, process.env.POE_CHECK_CACHE_DIR)), "napi-artifacts-v2")
    : path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "poe-code", "napi-artifacts-v2");
  const fallback = path.join(os.tmpdir(), "poe-code", "napi-artifacts-v2");
  return primary === fallback ? [primary] : [fallback, primary];
}

if (operation === "lint" || !existsSync(bindingManifest)) {
  for (const args of commands[operation]) run("cargo", args);
}

if ((operation === "build" || operation === "test") && existsSync(bindingManifest)) {
  const output = path.join(packageDirectory, "dist");
  const dtsName = existsSync(path.join(packageDirectory, "src/index.d.ts")) ? "native.d.ts" : "index.d.ts";
  const { digest: rustDigest } = computeRustInputsState();
  const pkgName = path.basename(packageDirectory);
  const cacheDirs = resolveNapiCacheDirectories();
  if (operation === "test") {
    const hasCachedCargoTest = cacheDirs.some((base) =>
      existsSync(path.join(base, `${pkgName}-${rustDigest}`, "cargo-test.ok"))
    );
    if (!hasCachedCargoTest) {
      for (const args of commands.test) run("cargo", args);
      for (const base of [...cacheDirs].reverse()) {
        try {
          const dest = path.join(base, `${pkgName}-${rustDigest}`);
          mkdirSync(dest, { recursive: true });
          writeFileSync(path.join(dest, "cargo-test.ok"), "ok\n");
          break;
        } catch (error) { void error; }
      }
    }
  }
  const cachedEntryDir = cacheDirs
    .map((base) => path.join(base, `${pkgName}-${rustDigest}`))
    .find((dir) => existsSync(dir) && existsSync(path.join(dir, dtsName)) && readdirSync(dir).some((name) => name.endsWith(".node")));

  const saveToNapiCache = (builtNodeName) => {
    for (const base of [...cacheDirs].reverse()) {
      try {
        const dest = path.join(base, `${pkgName}-${rustDigest}`);
        mkdirSync(dest, { recursive: true });
        copyNativeBinding(path.join(output, builtNodeName), path.join(dest, builtNodeName));
        copyFileSync(path.join(output, dtsName), path.join(dest, dtsName));
        break;
      } catch (error) { void error; }
    }
  };

  if (cachedEntryDir) {
    mkdirSync(output, { recursive: true });
    const cachedNode = readdirSync(cachedEntryDir).find((name) => name.endsWith(".node"));
    copyNativeBinding(path.join(cachedEntryDir, cachedNode), path.join(output, cachedNode));
    copyFileSync(path.join(cachedEntryDir, dtsName), path.join(output, dtsName));
  } else {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve("@napi-rs/cli/package.json")), "dist/cli.js");
    mkdirSync(output, { recursive: true });
    const psShim = "import { ChildProcess } from \"node:child_process\"; const orig = ChildProcess.prototype.spawn; ChildProcess.prototype.spawn = function(opts) { try { return orig.call(this, opts); } catch (e) { if (e?.code === \"EPERM\" && opts?.file === \"/bin/ps\") { process.nextTick(() => this.emit(\"error\", e)); return 0; } throw e; } };";
    run(process.execPath, [
      "--import",
      `data:text/javascript,${encodeURIComponent(psShim)}`,
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
      dtsName,
      "--release",
      "--",
      "--locked"
    ]);
    const builtNode = readdirSync(output).find((name) => name.endsWith(".node"));
    if (builtNode && existsSync(path.join(output, dtsName))) {
      saveToNapiCache(builtNode);
    }
  }
  for (const name of readdirSync(path.join(packageDirectory, "src"))) {
    if (name.endsWith(".js"))
      copyFileSync(path.join(packageDirectory, "src", name), path.join(output, name));
  }
  if (existsSync(path.join(packageDirectory, "src/index.d.ts"))) {
    copyFileSync(path.join(packageDirectory, "src/index.d.ts"), path.join(output, "index.d.ts"));
  }
  if (operation === "test") {
    runNativeTests(packageDirectory);
  }
}
