import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../../src/contracts/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createDiffPatchCommands, diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../src/shell/index.js";
import { contents, filesystem } from "./helpers.js";

test("shell diff compares /dev/null as an empty input and produces applicable patches", async () => {
  const fs = await filesystem({ source: "a\nb\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  try {
    const added = await shell.exec("diff -u /dev/null source");
    assert.equal(added.exitCode, 1, added.stderr);
    assert.equal(added.stderr, "");
    assert.equal(added.stdout, "--- /dev/null\n+++ source\n@@ -0,0 +1,2 @@\n+a\n+b\n");
    const removed = await shell.exec("diff -u source /dev/null");
    assert.equal(removed.exitCode, 1, removed.stderr);
    assert.equal(removed.stderr, "");
    assert.equal(removed.stdout, "--- source\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n");
    const applied = await shell.exec("patch", { stdin: removed.stdout });
    assert.equal(applied.exitCode, 0, applied.stderr);
    await assert.rejects(fs.stat("/work/source"), { code: "ENOENT" });
    const restored = await shell.exec("patch", { stdin: added.stdout });
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(await contents(fs, "source"), "a\nb\n");
  } finally { await shell.dispose(); }
});

for (const input of ["/dev/stdin", "/dev/fd/0"]) test(`shell diff reads ${input} until EOF`, async () => {
  const fs = await filesystem({ source: "a\nb\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  try {
    const result = await shell.exec(`diff -u ${input} source`, { stdin: "a\nb\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("shell diff accepts identical NUL-containing files", async () => {
  const fs = await filesystem({ input: Buffer.from("a\0b"), copy: Buffer.from("a\0b") });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  for (const command of ["diff input input", "diff input copy", "diff -q input copy", "diff -u input copy", "diff -y input copy", "diff -D SYMBOL input copy", "diff input - <copy", "diff - - <input"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stdout, "", command);
    assert.equal(result.stderr, "", command);
  }
  const reported = await shell.exec("diff -s input copy");
  assert.equal(reported.exitCode, 0, reported.stderr);
  assert.equal(reported.stdout, "Files input and copy are identical\n");
  assert.equal(reported.stderr, "");
});

test("plugin exposes stable command definitions and collision preflight", async () => {
  assert.deepEqual(createDiffPatchCommands().map(command => command.name), ["diff", "patch"]);
  const commands = new CommandRegistry([{ name: "patch", execute: () => ({ exitCode: 42 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => diffPatchCommands().setup(host), /already registered/u);
  assert.equal(commands.has("diff"), false);
  await diffPatchCommands({ replace: true }).setup(host);
  assert.equal(commands.has("diff"), true);
  assert.equal(commands.has("patch"), true);
});

test("shell redirects a patch, applies dry-run, patches, compares, and reverses", async () => {
  const fs = await filesystem({ old: "one\ntwo\n", next: "one\nTWO\n", target: "one\ntwo\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  const result = await shell.exec("diff -u --label target --label target old next >changes; status=$?; if test \"$status\" -eq 1; then patch --dry-run -i changes >status.log && patch -i changes >status.log && diff -q target next && patch -R -i changes >status.log && diff -q target old; else exit 9; fi");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(await contents(fs, "target"), "one\ntwo\n");
});

test("shell streaming diff-to-patch pipeline composes with tee and stdin", async () => {
  const fs = await filesystem({ old: "first\nlast", next: "first\nLAST", target: "first\nlast" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  const result = await shell.exec("diff -U0 --label target --label target old next | tee changes | patch >status.log; diff -q target next; cat changes | patch -R >status.log; diff -q target old");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(await contents(fs, "target"), "first\nlast");
});

test("shell recursive changes apply inside a subshell cwd with strip", async () => {
  const fs = await filesystem({ "old/keep": "old\n", "old/gone": "remove\n", "new/keep": "new\n", "new/added": "create\n", "target/keep": "old\n", "target/gone": "remove\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  const result = await shell.exec("diff -urN old new >changes; (cd target && patch -p1 -i ../changes >../status.log); diff -rq target new");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(await contents(fs, "target/keep"), "new\n");
  assert.equal(await contents(fs, "target/added"), "create\n");
});

test("shell here-document patch uses literal content and preserves failed-file bytes", async () => {
  const fs = await filesystem({ target: "$literal\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  const result = await shell.exec("patch <<'PATCH'\n--- target\n+++ target\n@@ -1 +1 @@\n-$literal\n+$(not-a-command)\nPATCH\ncat target");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "target"), "$(not-a-command)\n");
  const failed = await shell.exec("patch <<'PATCH'\n--- target\n+++ target\n@@ -1 +1 @@\n-wrong\n+changed\nPATCH\n");
  assert.equal(failed.exitCode, 1);
  assert.equal(await contents(fs, "target"), "$(not-a-command)\n");
});
