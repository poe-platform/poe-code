import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("agentCommands executes the reported portable command set after Buffer is deleted", async () => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";', { removeBuffer: true });
  const fs = new core.MemoryFileSystem();
  for (const [path, contents] of Object.entries({
    '/in.txt': 'alice\nbob\n', '/in2.txt': 'alice\ncarol\n',
    '/in.json': '{"a":2}', '/in.html': '<p>hello</p>',
  })) await fs.writeFile(path, new TextEncoder().encode(contents));
  const shell = new core.Shell({ fs }).use(core.agentCommands());
  try {
    for (const script of [
      'uniq /in.txt', 'paste /in.txt /in.txt', 'join /in.txt /in.txt',
      'nl /in.txt', 'fold -w 5 /in.txt', 'expand /in.txt', 'comm /in.txt /in.txt',
      "sed 's/alice/ALICE/' /in.txt", "awk '{ print $1 }' /in.txt", 'rg alice /in.txt',
      'jq .a /in.json', 'tar -cf /out.tar /in.txt', 'zip /out.zip /in.txt',
      'column -t /in.txt', 'html-to-markdown /in.html', 'expr 2 + 2',
      'file /in.txt', 'tree /', 'du --apparent-size /in.txt',
    ]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    }
    const diff = await shell.exec('diff -u /in.txt /in2.txt');
    assert.equal(diff.exitCode, 1, diff.stderr);
    assert.ok(diff.stdout.includes('-bob\n+carol\n'));
    assert.equal(diff.stderr, '');
    assert.ok((await fs.readFile('/out.tar')).byteLength > 0);
    assert.ok((await fs.readFile('/out.zip')).byteLength > 0);
  } finally { await shell.dispose(); }
});

test("core imports and executes commands without a host Buffer", async () => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";');
  const fs = new core.MemoryFileSystem();
  await fs.writeFile("/a.txt", new TextEncoder().encode("hello\nworld\n"));
  await fs.writeFile("/b.txt", new TextEncoder().encode("hello\nthere\n"));
  const shell = new core.Shell({ fs, commands: new core.CommandRegistry([
    ...core.createStandardCommands(), ...core.createStreamFormatCommands(),
    ...core.createDiffPatchCommands(), ...core.createDuCommands(),
    ...core.createTreeCommands(), ...core.createTextProgramCommands(),
    ...core.createSearchCommands(),
  ]) });
  try {
    for (const [script, output] of [
      ['printf -v x "%04d" 7; echo "$x"', "0007\n"],
      ["awk '{ print $1 }' /a.txt", "hello\nworld\n"],
      ["sed 's/hello/hi/' /a.txt", "hi\nworld\n"],
      ["grep hello /a.txt", "hello\n"],
      ["rg '(?<word>hello)' -r '$word/$1/$$' /a.txt", "hello/hello/$\n"],
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
