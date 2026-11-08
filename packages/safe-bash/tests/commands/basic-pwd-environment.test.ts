import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry, toByteSource } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const entry of [
  { value: "/alias", expected: "/alias" },
  { value: "/work", expected: "/work" },
  { value: "/other", expected: "/work" },
  { value: "", expected: "/work" },
  { value: "alias", expected: "/work" },
  { value: "/alias/../alias", expected: "/work" },
  { value: "/alias/.", expected: "/work" },
  { value: "/missing", expected: "/work" },
]) test(`external logical pwd validates PWD=${JSON.stringify(entry.value)}`, async () => {
  const fs = await fixture();
  await fs.symlink("/work", "/alias");
  await fs.mkdir("/other");
  const shell = new Shell({ fs, cwd: "/alias", commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec('env PWD="$VALUE" pwd -L', { env: { VALUE: entry.value } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${entry.expected}\n`);
    const builtin = await shell.exec('PWD="$VALUE" pwd -L', { env: { VALUE: entry.value } });
    assert.equal(builtin.stdout, "/alias\n");
  } finally { await shell.dispose(); }
});

test("external logical pwd observes cancellation before resolving exported PWD", async t => {
  const fs = await fixture();
  const controller = new AbortController();
  const expired = new Error("physical resolution cancelled");
  const reads: string[] = [];
  t.mock.method(fs, "realpath", async (path: string) => {
    reads.push(path);
    controller.abort(expired);
    return "/work";
  });
  const context = {
    command: "pwd", args: ["-L"], cwd: "/alias", env: { PWD: "/alias" }, fs,
    externalInvocation: true, signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("cancelled command wrote stdout"); } },
    stderr: { async write() { assert.fail("cancelled command wrote stderr"); } },
  };
  await assert.rejects(Promise.resolve(basicCommands().find(command => command.name === "pwd")!.execute(context)), (error: unknown) => error === expired);
  assert.deepEqual(reads, ["/alias"]);
});
