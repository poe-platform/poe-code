import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const owned = fileURLToPath(new URL("./", import.meta.url));
export const native = "tests/commands/regex-execution/continuation/artifacts/native";
const require = createRequire(import.meta.url);

export function createCopy() {
  const directory = mkdtempSync(join(owned, ".scratch-"));
  const boundaries = JSON.parse(readFileSync(join(root, "integration-boundaries.json"), "utf8")) as { fixtureDirectories: { owner: string }[] };
  for (const path of ["tsconfig.json", "package.json", "integration-boundaries.json", "integration-type-inputs.json", "scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", "scripts/test.mjs", "scripts/test-reporting.mjs", ...boundaries.fixtureDirectories.map(fixture => fixture.owner)]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(join(root, path), join(directory, path));
  }
  symlinkSync(dirname(dirname(require.resolve("tsx/package.json"))), join(directory, "node_modules"), "dir");
  return {
    directory,
    write(path: string, bytes: string) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
    },
    dispose() { rmSync(directory, { recursive: true, force: true }); },
  };
}

export function run(directory: string, command: string, args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  let executable = command, arguments_ = args;
  if (command === "npm" && process.env.npm_execpath) {
    executable = process.execPath;
    arguments_ = [process.env.npm_execpath, ...args];
  }
  const result = spawnSync(executable, arguments_, { cwd: directory, env, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

export function compile(directory: string, listOnly = false) {
  return run(directory, process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "--pretty", "false", "--typeRoots", dirname(dirname(require.resolve("@types/node/package.json"))), ...(listOnly ? ["--listFilesOnly"] : [])]);
}

export function diagnostics(output: string) {
  return output.split("\n").filter(line => line.includes("error TS"));
}

export function baseline() {
  return JSON.parse(readFileSync(join(owned, "classification.json"), "utf8")) as {
    counts: { files: number; rawPayloads: number; generatedCaches: number; maintainedSourcesOrHelpers: number };
    files: { path: string; bytes: number; sha256: string; classification: string }[];
  };
}
