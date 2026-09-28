import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { FsError } from "safe-bash-contracts/errors";
import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output-budget";
import { createHostnameCommand } from "./index.js";

function context(args: string[] = []): CommandContext {
  return { command: "hostname", args: createCommandArguments(args).args, cwd: "/", env: { UID: "1000" },
    fs: createMemoryFileSystem(), stdin: createBytePipe().readable,
    stdout: createBytePipe().writable, stderr: createBytePipe().writable, signal: new AbortController().signal };
}
async function run(command: CommandDefinition, ctx: CommandContext) {
  let stdout = "", stderr = "";
  const result = await command.execute({ ...ctx,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  return { ...result, stdout, stderr };
}
test("oversized identity files fail with a diagnostic", async () => {
  for (const path of ['/etc/hostname']) {
    const ctx = context();
    await ctx.fs.mkdir("/etc", { recursive: true });
    await ctx.fs.writeFile(path, new TextEncoder().encode("oversized"));
    const result = await run(createHostnameCommand({ limits: { maxFileBytes: 2 } }), ctx);
    assert.equal(result.exitCode, 1, path);
    assert.match(result.stderr, /size limit/);
    assert.equal(result.stdout, "");
  }
});
test("read failures preserve cancellation and unexpected errors", async () => {
  for (const path of ['/etc/hostname']) {
    for (const error of [new DOMException("cancelled", "AbortError"), Object.assign(new Error("budget"), { name: "BudgetExceededError" })]) {
      const ctx = context();
      const readFile = ctx.fs.readFile.bind(ctx.fs);
      const fs = { ...ctx.fs, readFile: async (file: string, options?: Parameters<typeof readFile>[1]) => {
        if (file === path) throw error;
        return readFile(file, options);
      } };
      await assert.rejects(run(createHostnameCommand(), { ...ctx, fs }), value => value === error);
    }
  }
});
test("hostname mutation stays in its filesystem", async () => {
  const command = createHostnameCommand({ allowSet: true });
  const ctx = context(["changed"]);
  assert.equal((await run(command, ctx)).exitCode, 0);
  assert.equal((await run(command, { ...ctx, args: createCommandArguments([]).args })).stdout, "changed\n");
  assert.equal((await run(command, context())).stdout, "sandbox\n");
});
test("hostname writes preserve budget and abort failures", async () => {
  for (const error of [new DOMException("cancelled", "AbortError"), Object.assign(new Error("budget"), { name: "BudgetExceededError" })]) {
    const ctx = { ...context(["changed"]), registerCleanup() {} };
    bindFileOutputBudget(ctx, () => ({ async write() { throw error; } }));
    await assert.rejects(run(createHostnameCommand({ allowSet: true }), ctx), value => value === error);
  }
});

test("abort during a completed read remains observable", async () => {
  const ctx = context();
  const controller = new AbortController();
  const fs = { ...ctx.fs, async readFile() {
    controller.abort();
    return new Uint8Array();
  } };
  await assert.rejects(run(createHostnameCommand(), { ...ctx, fs, signal: controller.signal }), { name: "AbortError" });
});
test("read-only hostname fallback belongs to the filesystem", async () => {
  const command = createHostnameCommand({ allowSet: true });
  const ctx = context(["changed"]);
  const fs = { ...ctx.fs, readFile: ctx.fs.readFile.bind(ctx.fs), async mkdir() { throw new FsError("EROFS"); } };
  assert.equal((await run(command, { ...ctx, fs })).exitCode, 0);
  assert.equal((await run(command, { ...ctx, fs, args: createCommandArguments([]).args })).stdout, "changed\n");
  assert.equal((await run(command, context())).stdout, "sandbox\n");
});
