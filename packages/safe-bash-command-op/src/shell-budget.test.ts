import assert from "node:assert/strict";
import { test } from "node:test";
import { readBytes, type CommandContext } from "safe-bash-contracts";
import { FsError } from "@poe-code/safe-fs/core";
import { createOpCommand, createOp, type OpCommandContext } from "./index.js";

function fixture(args: string[], maximum = 3) {
  const failure = Object.assign(new Error("maxInputBytes limit exceeded"), { name: "BudgetExceededError" });
  const checks: number[] = [];
  const caps: (number | undefined)[] = [];
  const context = {
    args, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(2); yield new Uint8Array(2); } },
    stdout: { async write() {} }, stderr: { async write() {} },
    invoke: async () => ({ exitCode: 0 }),
    inputBudget: { maxBytes: maximum, check(total: number) { checks.push(total); if (total > maximum) throw failure; } },
    fs: { capabilities: { read: true }, async readFile(_path: string, options: { maxBytes?: number }) {
      caps.push(options.maxBytes);
      return new Uint8Array(2);
    } },
  } as unknown as CommandContext;
  return { context, failure, checks, caps };
}

for (const args of [["inject"], ["inject", "-i", "file"], ["run", "--env-file", "one", "--env-file", "two", "child"], ["document", "create", "file"], ["item", "create", "-"]]) {
  test(`shell input ceiling rejects ${args.join(" ")}`, async () => {
    const run = fixture(args, 1);
    await assert.rejects(async () => createOpCommand().execute(run.context), error => error === run.failure);
  });
}

test("stdin and VFS reads share cumulative accounting and remaining read caps", async () => {
  const run = fixture(["inject"], 5);
  const command = createOpCommand({ handlers: { inject: async (_request, context) => {
    await context.readFile!("first");
    for await (const ignoredChunk of context.stdin) { /* consume */ }
    return { exitCode: 0 };
  } } });
  await assert.rejects(async () => command.execute(run.context), error => error === run.failure);
  assert.deepEqual(run.checks, [2, 4, 6]);
  assert.deepEqual(run.caps, [5]);
});

test("successive VFS reads use remaining capacity and allow the exact boundary", async () => {
  const run = fixture(["inject"], 4);
  const command = createOpCommand({ handlers: { inject: async (_request, context) => {
    await context.readFile!("first"); await context.readFile!("second");
    return { exitCode: 0 };
  } } });
  assert.equal((await command.execute(run.context)).exitCode, 0);
  assert.deepEqual(run.checks, [2, 4]);
  assert.deepEqual(run.caps, [4, 2]);
});

for (const source of ["stdin", "readFile", "stdout"] as const) {
  for (const failure of [Object.assign(new Error("budget"), { name: "BudgetExceededError" }), new FsError("EPIPE")]) {
    test(`dispatcher preserves ${failure.name}/${"code" in failure ? failure.code : "budget"} from ${source}`, async () => {
      const run = fixture(["inject"]);
      const context: OpCommandContext = { ...run.context, stdin: readBytes(run.context.stdin, run.context.signal),
        readFile: async () => { throw failure; } };
      if (source === "stdin") context.stdin = { async *[Symbol.asyncIterator]() { throw failure; yield new Uint8Array(); } };
      if (source === "readFile") context.args = ["inject", "-i", "file"];
      if (source === "stdout") { context.args = ["--version"]; context.stdout = { async write() { throw failure; } }; }
      await assert.rejects(createOp().execute(context), error => error === failure);
    });
  }
}

test("bounded VFS rejection becomes the shell budget error", async () => {
  const run = fixture(["inject", "-i", "large"]);
  run.context.fs.readFile = async () => { throw new FsError("EFBIG"); };
  await assert.rejects(async () => createOpCommand().execute(run.context), error => error === run.failure);
});

test("explicit host file callbacks cannot bypass the shell input ceiling", async () => {
  const run = fixture(["inject", "-i", "large"]);
  Object.assign(run.context, { readFile: async () => new Uint8Array(4) });
  await assert.rejects(async () => createOpCommand().execute(run.context), error => error === run.failure);
  assert.deepEqual(run.caps, []);
});
