import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const owned = fileURLToPath(new URL("./", import.meta.url));
export const native = "tests/commands/regex-execution/continuation/artifacts/native";

export function createCopy() {
  const directory = mkdtempSync(join(owned, ".scratch-"));
  for (const path of ["tsconfig.json", "package.json"]) copyFileSync(join(root, path), join(directory, path));
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
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
  const result = spawnSync(command, args, { cwd: directory, env, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

export function compile(directory: string, listOnly = false) {
  return run(directory, process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--pretty", "false", ...(listOnly ? ["--listFilesOnly"] : [])]);
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
