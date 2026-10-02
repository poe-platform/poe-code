import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, moreCommands, createMoreCommands } from "../../src/index.js";

test("standalone more registers only more and enforces its configured quota", async t => {
  assert.deepEqual(createMoreCommands().map(command => command.name), ["more"]);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(moreCommands({ maxInputBytes: 3 }));
  t.after(() => shell.dispose());
  assert.equal((await shell.exec("less", { stdin: "ab" })).exitCode, 127);
  const accepted = await shell.exec("more", { stdin: "abc" });
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(accepted.stdout, "abc");
  const rejected = await shell.exec("more", { stdin: "abcd" });
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /maximum size of 3 bytes/);
});
