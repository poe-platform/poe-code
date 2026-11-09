import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSpongeCommand, evalSyncSponge } from "./index.js";

const usage = "sponge [-a] <file>: soak up all input from stdin and write it to <file>\n";

for (const { args, invalid, stdout, target } of [
  { args: ["-x", "f"], invalid: "x", stdout: "", target: "abc" },
  { args: ["f", "-xy"], invalid: "xy", stdout: "", target: "abc" },
  { args: ["-xay", "f"], invalid: "xy", stdout: "", target: "OLDabc" },
  { args: ["--version"], invalid: "-version", stdout: "abc", target: "OLD" },
  { args: ["--append", "f"], invalid: "-ppend", stdout: "", target: "OLDabc" },
  { args: ["-h", "f"], invalid: "", stdout: usage, target: "OLD" },
  { args: ["f", "-h"], invalid: "", stdout: usage, target: "OLD" },
  { args: ["-ahx", "f"], invalid: "", stdout: usage, target: "OLD" },
  { args: ["-xh", "f"], invalid: "x", stdout: usage, target: "OLD" },
  { args: ["--help", "f"], invalid: "-", stdout: usage, target: "OLD" },
  { args: ["-x", "--", "f", "-h"], invalid: "x", stdout: "", target: "abc" },
]) {
  test(`sponge matches moreutils option outcomes for ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    await fs.writeFile("/f", encoder.encode("OLD"));
    let actualStdout = "";
    let actualStderr = "";
    const values = createCommandArguments(args);
    const result = await createSpongeCommand().execute({
      command: "sponge", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
      stdin: stdout === usage
        ? { [Symbol.asyncIterator]() { throw new Error("help must not read stdin"); } }
        : toByteSource("abc"),
      stdout: { async write(bytes) { actualStdout += decoder.decode(bytes); } },
      stderr: { async write(bytes) { actualStderr += decoder.decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(actualStdout, stdout);
    assert.equal(actualStderr, Array.from(invalid, ch => `sponge: invalid option -- '${ch}'\n`).join(""));
    assert.equal(decoder.decode(await fs.readFile("/f")), target);
  });
}

test("synchronous sponge handles grouped help without reading input or writing files", () => {
  for (const args of [["-h"], ["-ahx", "f"]]) {
    assert.equal(evalSyncSponge(undefined, args, undefined, () => {
      assert.fail("help must not write a file");
    }), usage);
  }
});

test("synchronous sponge defers diagnostics without writing files", () => {
  for (const args of [["-x", "f"], ["--version"], ["--append", "f"], ["--help"], ["-xh", "f"], ["f", "-h"]]) {
    assert.equal(evalSyncSponge(new TextEncoder().encode("abc"), args, undefined, () => {
      assert.fail("fallback must not write a file");
    }), undefined);
  }
});

test("sponge treats option-like filenames after -- literally", async () => {
  const fs = createMemoryFileSystem();
  const values = createCommandArguments(["--", "--help"]);
  const bytes = new TextEncoder().encode("abc");
  const result = await createSpongeCommand().execute({
    command: "sponge", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(bytes),
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
    signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/--help"), bytes);
  assert.equal(evalSyncSponge(bytes, ["--", "--help"], undefined, () => {
    assert.fail("file destinations must use the command executor");
  }), undefined);
});
