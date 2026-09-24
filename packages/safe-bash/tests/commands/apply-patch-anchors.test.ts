import assert from "node:assert/strict";
import test from "node:test";
import { createApplyPatchCommands } from "../../src/commands/apply-patch/index.js";
import { fixture, run } from "./helpers.js";

for (const [name, body, expected] of [
  ["anchored insertion", "@@ first\n+inserted", "first\ninserted\nsecond\nthird\n"],
  ["successive insertions", "@@ first\n+one\n@@ second\n+two", "first\none\nsecond\ntwo\nthird\n"],
  ["anchor context", "@@ first\n first\n-second\n+changed", "first\nchanged\nthird\n"],
  ["anchor deletion", "@@ first\n-first\n+changed\n second", "changed\nsecond\nthird\n"],
  ["nested anchors", "@@ first\n@@ second\n-second\n+changed", "first\nchanged\nthird\n"],
  ["EOF insertion", "@@ first\n+inserted\n*** End of File", "first\nsecond\nthird\ninserted\n"],
  ["unanchored insertion", "@@\n+inserted", "inserted\nfirst\nsecond\nthird\n"],
] as const) test(`apply_patch ${name}`, async () => {
  const fs = await fixture({ "file.txt": "first\nsecond\nthird\n" });
  const result = await run("apply_patch", [], { fs, commands: createApplyPatchCommands(), stdin: `*** Begin Patch\n*** Update File: file.txt\n${body}\n*** End Patch\n` });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/file.txt")), expected);
});

for (const bytes of [new Uint8Array(), new TextEncoder().encode("first\r\nsecond"), new Uint8Array([255, 0, 128])]) {
  test(`apply_patch pure move preserves ${JSON.stringify([...bytes])}`, async () => {
    const fs = await fixture({ "old.txt": bytes });
    const result = await run("apply_patch", [], { fs, commands: createApplyPatchCommands(), stdin: "*** Begin Patch\n*** Update File: old.txt\n*** Move to: nested/new.txt\n*** End Patch\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/work/nested/new.txt"), bytes);
    await assert.rejects(fs.readFile("/work/old.txt"), { code: "ENOENT" });
  });
}

for (const body of ["", "@@", "*** Move to: new.txt\n@@", "*** Move to: new.txt\n@@ first"]) {
  test(`apply_patch rejects empty update hunk ${JSON.stringify(body)}`, async () => {
    const fs = await fixture({ "file.txt": "first\n" });
    const result = await run("apply_patch", [], { fs, commands: createApplyPatchCommands(), stdin: `*** Begin Patch\n*** Update File: file.txt\n${body ? body + "\n" : ""}*** End Patch\n` });
    assert.equal(result.exitCode, 2);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/file.txt")), "first\n");
  });
}
