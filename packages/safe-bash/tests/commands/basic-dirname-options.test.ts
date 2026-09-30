import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const entry of [
  { args: ["dir/file", "-z"], output: "dir\0", posix: "dir\n.\n" },
  { args: ["dir/file", "--zero"], output: "dir\0", posix: "dir\n.\n" },
  { args: ["dir/file", "--", "other/item"], output: "dir\nother\n", posix: "dir\n.\nother\n" },
]) for (const posix of [undefined, "", "1"]) {
  test(`dirname trailing option ${JSON.stringify(entry.args)} POSIXLY_CORRECT=${JSON.stringify(posix)}`, async () => {
    const result = await run("dirname", entry.args, {
      commands: basicCommands(), env: posix === undefined ? {} : { POSIXLY_CORRECT: posix },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, posix === undefined ? entry.output : entry.posix);
  });
}
