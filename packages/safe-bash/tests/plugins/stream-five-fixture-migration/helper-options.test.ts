import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell, splitCommands, streamFormatCommands } from "../../../src/index.js";
import { shell } from "../../commands/stream-format/helpers.js";

test("migrated helper preserves formatting limits without imposing them on split or cat", async () => {
  const instance = shell({ limits: { maxInputBytes: 3 } });
  try {
    for (const name of ["nl", "rev", "unexpand"]) assert.equal((await instance.exec(name, { stdin: "abcd" })).exitCode, 1, name);
    const cat = await instance.exec("cat", { stdin: "abcd" });
    assert.equal(cat.exitCode, 0, cat.stderr);
    assert.equal(cat.stdout, "abcd");
    const split = await instance.exec("split -b2", { stdin: "abcd" });
    assert.equal(split.exitCode, 0, split.stderr);
    assert.equal((await instance.exec("cat xaa xab")).stdout, "abcd");
  } finally { await instance.dispose(); }
});

test("migrated helper preserves explicit locale and supplied cancellation", async () => {
  const instance = shell({}, { LC_ALL: "en_US.UTF-8" });
  try {
    const result = await instance.exec("rev", { stdin: "é🙂\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "🙂é\n");
    const controller = new AbortController();
    const reason = new Error("fixture migration cancellation");
    controller.abort(reason);
    await assert.rejects(instance.exec("seq 3", { signal: controller.signal }), error => error === reason);
  } finally { await instance.dispose(); }
});

test("migrated helper retains seq output limits and intentional replacement options", async () => {
  const instance = shell({ replace: true, limits: { maxOutputBytes: 3 } });
  try {
    assert.equal((await instance.exec("seq 3")).exitCode, 1);
    const cat = await instance.exec("cat", { stdin: "abcdef" });
    assert.equal(cat.exitCode, 0, cat.stderr);
    assert.equal(cat.stdout, "abcdef");
  } finally { await instance.dispose(); }
});

test("aggregate split configuration reaches split without constraining formatting", async () => {
  const instance = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ split: { limits: { maxInputBytes: 3 } } }));
  try {
    assert.equal((await instance.exec("split -b2", { stdin: "abcd" })).exitCode, 1);
    const result = await instance.exec("rev", { stdin: "abcd\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "dcba\n");
  } finally { await instance.dispose(); }
});

for (const [name, plugin] of [["seq", streamFormatCommands()], ["split", splitCommands()]] as const) {
  test(`explicit ${name} family still rejects duplicate default installation`, async () => {
    const instance = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(plugin);
    try { await assert.rejects(instance.exec(name), new RegExp(`Command already registered: ${name}`, "u")); }
    finally { await instance.dispose(); }
  });
}
