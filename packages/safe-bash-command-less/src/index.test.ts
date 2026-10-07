import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createLessCommand, settings } from "./index.js";

test("less command definition exports standard contract", () => {
  const def = createLessCommand();
  assert.equal(def.name, "less");
  assert.equal(typeof def.execute, "function");
});

test("less input quotas are optional with equivalent flat and nested options", () => {
  assert.equal(settings().maxInputBytes, Infinity);
  assert.equal(settings({ limits: { ["maxInputBytes" as string]: undefined } }).maxInputBytes, Infinity);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxInputBytes: value }).maxInputBytes, value);
    assert.equal(settings({ limits: { maxInputBytes: value } }).maxInputBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ maxInputBytes: value }), RangeError);
});

test("less preserves leading UTF-8 BOM in pattern search and line-number modes and recovers across missing files", async () => {
  const fs = createMemoryFileSystem();
  const bomText = new TextEncoder().encode("\uFEFFalpha\n\n\nbeta\n");
  await fs.writeFile("/doc.txt", bomText);

  const run = async (rawArgs: string[]) => {
    let stdout = "";
    let stderr = "";
    const res = await createLessCommand().execute({
      command: "less",
      args: createCommandArguments(rawArgs).args,
      cwd: "/",
      env: {},
      fs,
      signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    return { exitCode: res.exitCode, stdout, stderr };
  };

  const resSearch = await run(["-Ns", "-i", "+/ALPHA", "/missing.txt", "/doc.txt"]);
  assert.equal(resSearch.exitCode, 1);
  assert.match(resSearch.stderr, /^less: \/missing\.txt:/);
  assert.equal(resSearch.stdout, "     1  \uFEFFalpha\n     2  \n     4  beta\n");
});
