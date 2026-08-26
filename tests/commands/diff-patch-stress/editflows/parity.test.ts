import assert from "node:assert/strict";
import test from "node:test";
import { diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { flows, mailPatch, relaxedPatch, replacement } from "./fixtures.js";
import { cwd, expectedBytes, fileBytes, memory, run } from "./helpers.js";
import { native as gnu } from "../../diff-patch/helpers.js";

for (const flow of flows) test(`edit-flow parity: ${flow.name}`, async context => {
  const filesystem = await memory(flow.files);
  const result = await run("patch", flow.args, filesystem, flow.input);
  context.diagnostic(JSON.stringify({ status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() }));
  assert.deepEqual({ status: result.status, files: await fileBytes(filesystem, Object.keys(flow.expected)), stderr: result.stderr },
    { status: 0, files: expectedBytes(flow.expected), stderr: Buffer.alloc(0) });
});

test("edit-flow parity: default diff emits exact normal-format bytes", async () => {
  const result = await run("diff", ["before", "after"], await memory({ before: "old\n", after: "new\n" }));
  assert.deepEqual(result, { status: 1, stdout: Buffer.from("1c1\n< old\n---\n> new\n"), stderr: Buffer.alloc(0) });
});

test("Shell plugin integration applies a saved mail patch through stdin redirection", async () => {
  const filesystem = await memory({ target: "old\n", "change.eml": mailPatch });
  const shell = new Shell({ fs: filesystem, cwd }).use(diffPatchCommands());
  const result = await shell.exec("patch -p1 < change.eml");
  assert.deepEqual({ status: result.exitCode, stderr: result.stderr, files: await fileBytes(filesystem, ["target"]) },
    { status: 0, stderr: "", files: expectedBytes({ target: "new\n" }) });
});

test("GNU default without -l whitespace causes a hunk conflict and publishes rejects", async () => {
  const files = { target: "if\t(ready) {\n\told\tvalue;\n}\n" };
  const filesystem = await memory(files);
  const args = ["--batch", "--no-backup-if-mismatch"];
  const reference = await gnu("patch", args, files, relaxedPatch);
  assert.equal(reference.exitCode, 1);
  const result = await run("patch", args, filesystem, relaxedPatch);
  assert.deepEqual({ status: result.status, stdout: result.stdout.toString(), files: await fileBytes(filesystem, Object.keys(reference.files)) },
    { status: 1, stdout: reference.stdout, files: expectedBytes(reference.files) });
  assert.deepEqual((await filesystem.readdir(cwd)).map(entry => entry.name).sort(), Object.keys(reference.files).sort());
});

test("GNU default -l rejects an absent blank run and publishes rejects", async () => {
  const files = { target: "oldvalue\n" };
  const filesystem = await memory(files);
  const args = ["--batch", "--no-backup-if-mismatch", "-l"];
  const input = replacement("target", "target", "old value", "new");
  const reference = await gnu("patch", args, files, input);
  assert.equal(reference.exitCode, 1);
  const result = await run("patch", args, filesystem, input);
  assert.deepEqual({ status: result.status, stdout: result.stdout.toString(), files: await fileBytes(filesystem, Object.keys(reference.files)) },
    { status: 1, stdout: reference.stdout, files: expectedBytes(reference.files) }, result.stderr.toString());
  assert.deepEqual((await filesystem.readdir(cwd)).map(entry => entry.name).sort(), Object.keys(reference.files).sort());
});

test("atomic extension sequential section conflict preflights against staged content without early writes", async () => {
  const filesystem = await memory({ target: "old\n" });
  const input = replacement("target", "target", "old", "middle") + replacement("target", "target", "wrong", "new");
  const result = await run("patch", ["--atomic"], filesystem, input);
  assert.deepEqual({ status: result.status, stdout: result.stdout, files: await fileBytes(filesystem, ["target"]) },
    { status: 1, stdout: Buffer.alloc(0), files: expectedBytes({ target: "old\n" }) }, result.stderr.toString());
});
