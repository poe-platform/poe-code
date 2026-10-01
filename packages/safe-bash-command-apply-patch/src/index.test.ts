import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createApplyPatchCommand } from "./index.js";
import type { ApplyPatchLimits } from "./options.js";

async function update(limits: Partial<ApplyPatchLimits> = {}, extra: Partial<CommandContext> = {}) {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/file", new TextEncoder().encode("anchor\nold\n"));
 const input = "*** Begin Patch\n*** Update File: /file\n@@ anchor\n-old\n+new\n*** End Patch\n";
 let stderr = "";
 const result = await createApplyPatchCommand({ limits }).execute({
  command: "apply_patch", args: [], cwd: "/", env: {}, fs, stdin: toByteSource(input),
  stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal, ...extra,
 });
 return { ...result, stderr, fs, input };
}

test("named anchors count one hunk and input lines are not charged again as output records", async () => {
 const result = await update({ maxHunks: 1, maxLines: 8 });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(new TextDecoder().decode(await result.fs.readFile("/file")), "anchor\nnew\n");
 assert.notEqual((await update({ maxLines: 7 })).exitCode, 0);
 const two = "*** Begin Patch\n*** Update File: /file\n@@ anchor\n+first\n@@ old\n+second\n*** End Patch\n";
 assert.notEqual((await update({ maxHunks: 1 }, { stdin: toByteSource(two) })).exitCode, 0);
});

test("invocation applyPatch limits restrict configured limits", async () => {
 const result = await update({}, { capabilities: { commandLimits: { applyPatch: { maxPatchBytes: 1 } } } });
 assert.notEqual(result.exitCode, 0);
 assert.equal(new TextDecoder().decode(await result.fs.readFile("/file")), "anchor\nold\n");
 assert.notEqual((await update({ maxPatchBytes: 1 }, { capabilities: { commandLimits: { applyPatch: { maxPatchBytes: 1000 } } } })).exitCode, 0);
});

test("input budget receives cumulative stdin and target reads, including rechecks", async () => {
 const totals: number[] = [];
 const result = await update({}, { inputBudget: { maxBytes: Infinity, check(total) { totals.push(total); } } });
 assert.equal(result.exitCode, 0, result.stderr);
 const bytes = new TextEncoder().encode(result.input).length;
 assert.deepEqual(totals, [bytes, bytes + 11, bytes + 22]);
});

test("apply-patch behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments([]);
 let output = "";
 const result = await createApplyPatchCommand().execute({
  command: "apply-patch", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("*** Begin Patch\n*** Add File: /hello.txt\n+hello\n*** End Patch\n"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.equal(output, "Success. Updated the following files:\nA /hello.txt\n");
});
