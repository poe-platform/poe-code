import assert from "node:assert/strict";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, FsError, writeText, toByteSource } from "../../src/index.js";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs, env: { PUBLIC: "parent" } }).use(agentCommands());
let checks = 0;
async function limit(source: string, name: "maxCommands" | "maxSubstitutionDepth" | "maxOutputBytes" | "maxSourceBytes" | "maxLoopIterations", value: number) {
  await assert.rejects(shell.exec(source, { limits: { [name]: value } }), error => error instanceof ShellLimitError && error.limit === name);
  checks++;
}
shell.register({ name: "again", execute: context => context.invoke!("again", [], { replaceEnv: true }) });
await limit("again", "maxSubstitutionDepth", 4);
await limit("env -i env -i env -i true", "maxCommands", 3);
await limit("env -i bash -c 'while true; do :; done'", "maxLoopIterations", 3);
await limit("env -i printf abcdef", "maxOutputBytes", 3);
const source = "env -i bash -c 'echo é'";
await limit(source, "maxSourceBytes", Buffer.byteLength(source) + Buffer.byteLength("echo é") - 1);

const controller = new AbortController();
const reason = new FsError("EACCES", { path: "typed cancellation" });
let entered = false;
let parentEnvironment: Record<string, string> | undefined;
shell.register({ name: "cancel-parent", execute(context) {
  parentEnvironment = context.env;
  return context.invoke!("late", [], { replaceEnv: true });
} });
shell.register({ name: "late", async execute(context) {
  entered = true;
  assert.deepEqual({ ...context.env }, {});
  assert.equal(context.signal.aborted, false);
  setTimeout(() => controller.abort(reason), 5);
  await new Promise((_, reject) => setTimeout(() => reject(new Error("observed late failure")), 20));
  return { exitCode: 0 };
} });
await assert.rejects(shell.exec("cancel-parent", { signal: controller.signal }), error => error === reason);
assert.equal(entered, true);
assert.deepEqual({ ...parentEnvironment }, { PUBLIC: "parent", PWD: "/" });
await new Promise(resolve => setTimeout(resolve, 35));
checks++;

const readController = new AbortController();
const readReason = new Error("blocked supplied input");
let closed = false;
const blocked = { [Symbol.asyncIterator]() { return {
  next() { setTimeout(() => readController.abort(readReason), 5); return new Promise<IteratorResult<Uint8Array>>((_, reject) => setTimeout(() => reject(new Error("late input failure")), 20)); },
  async return() { closed = true; return { done: true as const, value: undefined }; },
}; } };
await assert.rejects(shell.exec("env -i cat", { stdin: blocked, signal: readController.signal }), error => error === readReason);
await new Promise(resolve => setTimeout(resolve, 35));
assert.equal(closed, true);
checks++;

shell.register({ name: "replace-input", execute: context => context.invoke!("origin", [], { replaceEnv: true, stdin: toByteSource(Uint8Array.from([0, 255])) }) });
shell.register({ name: "origin", async execute(context) {
  assert.equal(context.stdinIsDefault, false); assert.deepEqual({ ...context.env }, {});
  const chunks = []; for await (const chunk of context.stdin) chunks.push(...chunk);
  assert.deepEqual(chunks, [0, 255]); return { exitCode: 0 };
} });
assert.equal((await shell.exec("replace-input")).exitCode, 0); checks++;

shell.register({ name: "failure", async execute() { throw new Error("child failure"); } });
shell.register({ name: "catch-child", async execute(context) {
  const original = { ...context.env };
  const result = await context.invoke!("failure", [], { replaceEnv: true });
  assert.notEqual(result.exitCode, 0); assert.deepEqual({ ...context.env }, original);
  await writeText(context.stdout, context.env.PUBLIC!); return { exitCode: 0 };
} });
assert.equal((await shell.exec("catch-child")).stdout, "parent"); checks++;
await shell.dispose();
console.log(JSON.stringify({ checks }));
