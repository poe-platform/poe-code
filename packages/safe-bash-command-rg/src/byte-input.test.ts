import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

const cases: readonly [string[], Uint8Array, Uint8Array, number][] = [
  [["✓|FAIL"], Buffer.from("check ✓\n"), Buffer.from("check ✓\n"), 0],
  [["✓|FAIL"], Buffer.from("FAIL\n"), Buffer.from("FAIL\n"), 0],
  [["✓|FAIL"], Buffer.from("pass\n"), Buffer.from(""), 1],
  [["-o", "🦀+|FAIL"], Buffer.from("check 🦀🦀\n"), Buffer.from("🦀🦀\n"), 0],
  [["-ni", "commander"], Buffer.from("commander 🦀\n"), Buffer.from("1:commander 🦀\n"), 0],
  [["-ni", "detach|consume|encodepng"], Buffer.from("Consume 🦀\n"), Buffer.from("1:Consume 🦀\n"), 0],
  [["x"], Uint8Array.of(255), Buffer.from(""), 1],
  [["x"], Buffer.from([255, 120, 10]), Buffer.from([255, 120, 10]), 0],
  [["x+"], Buffer.from([255, 120, 120, 10]), Buffer.from([255, 120, 120, 10]), 0],
  [["-F", "é"], Buffer.from([255, 195, 169, 10]), Buffer.from([255, 195, 169, 10]), 0],
  [["-i", "x"], Buffer.from([255, 88, 10]), Buffer.from([255, 88, 10]), 0],
  [["-o", "x+"], Buffer.from([255, 120, 120, 10]), Buffer.from("xx\n"), 0],
  [["-o", "."], Buffer.from([255, 195, 169, 10]), Buffer.from("é\n"), 0],
  [["-o", "[^x]"], Buffer.from([255, 195, 169, 10]), Buffer.from("é\n"), 0],
  [["-x", "x"], Buffer.from([255, 120, 10]), Buffer.from(""), 1],
  [["--count-matches", ""], Buffer.from("é🦊"), Buffer.from("6\n"), 0],
  [["--count-matches", ""], Buffer.from("é🦊\n"), Buffer.from("7\n"), 0],
  [["--count-matches", "-F", ""], Buffer.from("é🦊"), Buffer.from("6\n"), 0],
  [["--count-matches", ""], Buffer.from("abc"), Buffer.from("3\n"), 0],
  [["--count-matches", ""], Buffer.from("abc\n"), Buffer.from("4\n"), 0],
  [["--count-matches", ""], Buffer.from(""), Buffer.from(""), 1],
  [["--count-matches", "$"], Buffer.from("é🦊"), Buffer.from("1\n"), 0],
];

for (const [args, input, expected, exitCode] of cases) test(`rg searches arbitrary stdin bytes: ${JSON.stringify(args)} ${Buffer.from(input).toString("hex")}`, async () => {
  const values = createCommandArguments([...args, "-"]);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createRgCommand().execute({
    command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    signal: new AbortController().signal,
  });
  assert.equal(Buffer.concat(stderr).toString(), "");
  assert.equal(result.exitCode, exitCode);
  assert.deepEqual(Buffer.concat(stdout), expected);
  if (process.env.SAFE_BASH_TEST_RG === "1") {
    const native = spawnSync("rg", ["--no-config", ...args, "-"], { input });
    assert.ifError(native.error);
    assert.equal(result.exitCode, native.status);
    assert.deepEqual(Buffer.concat(stdout), native.stdout);
  }
});

test("recursive rg continues past non-UTF-8 and NUL-containing files", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/files");
  await fs.writeFile("/files/a", Uint8Array.of(255));
  await fs.writeFile("/files/b", Uint8Array.of(255, 120, 10));
  await fs.writeFile("/files/c", Uint8Array.of(0, 120, 10));
  await fs.writeFile("/files/d", Buffer.from("x\n"));
  for (const pattern of ["x", "x+"]) {
    const values = createCommandArguments(["--sort", "path", "-l", pattern, "/files"]);
    let stdout = "", stderr = "";
    const result = await createRgCommand().execute({
      command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
      stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(stdout, "/files/b\n/files/d\n");
  }
});
