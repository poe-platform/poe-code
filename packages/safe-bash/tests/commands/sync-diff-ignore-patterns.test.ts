import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";
import { diffPatchCommands } from "../../src/commands/diff-patch/index.js";

for (const [description, pattern, left, right, changed] of [
  ["unmatched differences", "^IGNORE", "left\n", "right\n", true],
  ["literal plus in BRE", "^a+b$", "left\n", "right\n", true],
  ["anchored header matches", "^hdr_", "hdr_v1\nsame\n", "hdr_v2\nsame\n", false],
  ["BRE repeated atom", "^a\\+b$", "ab\nsame\n", "aab\nsame\n", false],
  ["BRE character classes", "^[0-9]*$", "123\nsame\n", "456\nsame\n", false],
] as const) {
  test("diff substitution preserves " + description, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a", new TextEncoder().encode(left));
    await fs.writeFile("/b", new TextEncoder().encode(right));
    const shell = new Shell({ fs }).use(standardCommands()).use(diffPatchCommands());
    const result = await shell.exec("result=$(diff -I '" + pattern + "' /a /b); code=$?; printf '%s:%s' \"$code\" \"$result\"");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, changed ? "1:1c1\n< left\n---\n> right" : "0:");
  });
}
