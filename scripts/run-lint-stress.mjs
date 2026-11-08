import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckCache } from "./check-cache.mjs";

const LINT_STRESS_INPUTS = [
  "eslint.config.js",
  "vitest.lint-stress.config.ts",
  "scripts/lint-eslint.mjs",
  "scripts/lint-eslint.stress.ts",
  "scripts/lint-eslint.fixtures.js",
  "scripts/lint-input-guard.mjs",
  "scripts/native-lint-backend.mjs",
  "scripts/lint-diagnostics-cache.mjs"
];

export function computeLintStressCacheKey(root, { fileSystem = fs } = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(`lint-stress-v1\0${process.version}\0`);
  const pkgPath = path.join(root, "package.json");
  if (fileSystem.existsSync && fileSystem.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fileSystem.readFileSync(pkgPath, "utf8"));
      hash.update(`lint:eslint=${pkg?.scripts?.["lint:eslint"] ?? ""}\0`);
    } catch {
      hash.update(fileSystem.readFileSync(pkgPath));
    }
  }
  for (const rel of LINT_STRESS_INPUTS) {
    const full = path.join(root, rel);
    if (!fileSystem.existsSync || !fileSystem.existsSync(full)) continue;
    hash.update(rel);
    hash.update("\0");
    hash.update(fileSystem.readFileSync(full));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function runLintStress({
  root = fileURLToPath(new URL("../", import.meta.url)),
  args = [],
  fileSystem = fs,
  env = process.env,
  spawn = spawnSync,
  cacheStore
} = {}) {
  const caching =
    args.length === 0 &&
    env.POE_CHECK_CACHE !== "0" &&
    env.POE_CHECK_NO_CACHE !== "1" &&
    env.TURBO_FORCE !== "true";
  const store =
    cacheStore !== undefined
      ? cacheStore
      : caching
        ? createCheckCache({ rootDirectory: root, environment: env, fileSystem })
        : null;

  const key = store ? computeLintStressCacheKey(root, { fileSystem }) : null;
  if (store && key && store.read(key)?.success === true) {
    return 0;
  }

  const vitestBin = path.join(root, "node_modules", "vitest", "vitest.mjs");
  const result = spawn(
    process.execPath,
    [vitestBin, "run", "--config", "vitest.lint-stress.config.ts", ...args],
    { cwd: root, stdio: "inherit", env }
  );
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status === 0 && store && key) {
    store.write(key, { success: true });
  }
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runLintStress({ args: process.argv.slice(2) });
}
