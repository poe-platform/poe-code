import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, makeFileSystem, runVirtual } from "./helpers.js";

test("sed rejects unsupported or malformed programs before stdout, input, backup or file effects", async () => {
  for (const program of ["p;s/a/b/e", "p;w", "p;{", "p;b missing", "p;s/(/x/", "p;s/a/\\9/"]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("a\n"); })();
    const result = await runVirtual("sed", { args: ["-E", "-i.bak", program, "input"], files: { input: "a\n" } }, {}, source);
    assert.notEqual(result.exitCode, 0, program);
    assert.equal(result.stdout.length, 0, program);
    assert.equal(consumed, false, program);
    assert.deepEqual(result.files, { input: Buffer.from("a\n") }, program);
  }
});

test("sed branch and regex work are budgeted and failed in-place execution preserves originals", async () => {
  const loop = await runVirtual("sed", { args: ["-i.bak", ":again\nb again", "input"], files: { input: "a\n" } }, { maxSteps: 50 });
  assert.equal(loop.exitCode, 2);
  assert.match(loop.stderr.toString(), /step limit/u);
  assert.deepEqual(loop.files, { input: Buffer.from("a\n") });
  const regex = await runVirtual("sed", { args: ["-E", "s/(a+)+b/X/"], stdin: "a".repeat(1000) }, { maxSteps: 2000 });
  assert.equal(regex.exitCode, 2);
  assert.match(regex.stderr.toString(), /step limit/u);
});

test("sed accepts one-byte input chunks and composes with the virtual shell", async () => {
  const streamed = await runVirtual("sed", { args: ["s/pear/apple/g"], stdin: "pear\npear" }, {}, byteChunks("pear\npear"));
  assert.equal(streamed.stdout.toString(), "apple\napple");
  const fs = await makeFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("printf 'keep:pear\\nskip:no\\nkeep:apple\\n' | sed -n '/^keep:/{s/^keep://;p;}' | sort | tee result");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "apple\npear\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/result")), result.stdout);
});
