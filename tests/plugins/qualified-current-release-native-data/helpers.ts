import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  let executable = command, arguments_ = args;
  if (command === "npm") {
    const cli = "/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js";
    const stat = lstatSync(cli);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(realpathSync(cli), cli);
    assert.equal(stat.size, 54);
    assert.equal(stat.mode & 0o777, 0o755);
    assert.equal(createHash("sha256").update(readFileSync(cli)).digest("hex"), "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7");
    executable = process.execPath;
    arguments_ = [cli, ...args];
  }
  const result = spawnSync(executable, arguments_, { cwd: directory, env, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
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
