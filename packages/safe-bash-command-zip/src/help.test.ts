import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createZipCommand } from "./index.js";

async function execute(fs: FileSystem, args: readonly string[]) {
  const values = createCommandArguments(args);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createZipCommand().execute({
    command: "zip", args: values.args, argumentValues: values, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const args of [["-h2"], ["--more-help"], ["--more"], ["-qh2"], ["-h2", "--unknown"], ["-h22"], ["-", "-h2"]]) {
  test(`zip extended help exits without archive work ${args}`, async () => {
    const fs = createMemoryFileSystem();
    const denied = new Proxy(fs, { get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? () => { throw new Error(`unexpected filesystem operation ${String(key)}`); } : value;
    } });
    const result = await execute(denied, args);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = result.stdout.toString();
    for (const section of ["Usage:", "Selection", "Archive operations", "Streaming", "ZIPOPT"]) assert.ok(output.includes(section), output);
    assert.ok(output.includes("conditional byte publication"), output);
    assert.equal(result.stderr, "");
  });
}

for (const args of [["-h2-"], ["--more-help-"], ["--more-help=value"], ["--unknown", "-h2"]]) {
  test(`zip extended help preserves invalid argument status ${args}`, async () => {
    const result = await execute(createMemoryFileSystem(), args);
    assert.equal(result.exitCode, 16);
    assert.ok(!result.stdout.toString().includes("Usage:"));
  });
}
