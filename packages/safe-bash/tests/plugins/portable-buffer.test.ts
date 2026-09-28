import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("core imports and executes commands without a host Buffer", async () => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";');
  const fs = new core.MemoryFileSystem();
  await fs.writeFile("/a.txt", new TextEncoder().encode("hello\nworld\n"));
  await fs.writeFile("/b.txt", new TextEncoder().encode("hello\nthere\n"));
  const shell = new core.Shell({ fs, commands: new core.CommandRegistry([
    ...core.createStandardCommands(), ...core.createStreamFormatCommands(),
    ...core.createDiffPatchCommands(), ...core.createDuCommands(),
    ...core.createTreeCommands(), ...core.createTextProgramCommands(),
  ]) });
  try {
    for (const [script, output] of [
      ['printf -v x "%04d" 7; echo "$x"', "0007\n"],
      ["awk '{ print $1 }' /a.txt", "hello\nworld\n"],
      ["sed 's/hello/hi/' /a.txt", "hi\nworld\n"],
      ["grep hello /a.txt", "hello\n"],
      ["printf hello | tr a-z A-Z", "HELLO"],
      ["printf hello | xargs echo", "hello\n"],
    ]) {
      const result = await shell.exec(script!, { limits: { maxExpansionBytes: 4096 } });
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
      assert.equal(result.stderr, "", script);
      assert.equal(result.stdout, output, script);
    }
    const diff = await shell.exec("diff -u /a.txt /b.txt");
    assert.equal(diff.exitCode, 1, diff.stderr);
    assert.equal(diff.stderr, "");
    assert.ok(diff.stdout.includes("-world\n+there\n"));
    const patch = await shell.exec("patch /a.txt", { stdin: diff.stdout });
    assert.equal(patch.exitCode, 0, patch.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/a.txt")), "hello\nthere\n");
    const allocation = await shell.exec("du /a.txt");
    assert.equal(allocation.exitCode, 1);
    assert.equal(allocation.stderr, 'du: "/a.txt": allocated bytes unknown; total suppressed\n');
    for (const script of ["du --apparent-size /a.txt", "tree /"]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.includes("a.txt"));
    }
  } finally { await shell.dispose(); }
});
