import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { openFileOutput } from "../../src/contracts/filesystem-output.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";

test("actual Shell custom output API retains the native-qualified renamed target", async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  shell.register({ name: "retained", async execute(invocation) {
    const target = await openFileOutput(invocation, "/out", { flag: "w", descriptor: true });
    await target.sink.write(Uint8Array.of(97));
    await fs.rename("/out", "/moved");
    await target.sink.write(Uint8Array.of(98));
    await target.finish();
    const moved = await fs.readFile("/moved");
    let out = 0;
    try { await fs.stat("/out"); } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      out = 1;
    }
    await invocation.stdout.write(Buffer.from(`moved=<${Buffer.from(moved).toString()}>;out=${out}`));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("retained");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "6d6f7665643d3c61623e3b6f75743d31");
  assert.deepEqual(await fs.readFile("/moved"), Uint8Array.of(97, 98));
  await assert.rejects(fs.stat("/out"), { code: "ENOENT" });
});

for (const maximum of [2, 3]) test(`canonical named bytes and stdout share one actual Shell budget: ${maximum}`, async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, limits: { maxOutputBytes: maximum } });
  context.after(() => shell.dispose());
  shell.register({ name: "write", async execute(invocation) {
    const target = await openFileOutput(invocation, "/out", { flag: "w", descriptor: true });
    await target.sink.write(Uint8Array.of(0, 255));
    await target.finish();
    await invocation.stdout.write(Uint8Array.of(128));
    return { exitCode: 0 };
  } });
  if (maximum === 2) await assert.rejects(shell.exec("write"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  else {
    const result = await shell.exec("write");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(128));
  }
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(0, 255));
});
