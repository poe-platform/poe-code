import assert from "node:assert/strict";
import { FsError } from "../../src/contracts/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const name = process.argv[2];
if (name === "command-depth" || name === "command-count") {
  const limit = name === "command-depth" ? "maxSubstitutionDepth" : "maxCommands";
  await assert.rejects(setup({ limits: { [limit]: 8 } }).shell.exec(`${"command ".repeat(30)}true`), error => error instanceof ShellLimitError && error.limit === limit);
} else if (name === "command-output") {
  await assert.rejects(setup({ limits: { maxOutputBytes: 5 } }).shell.exec("command type true"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
} else if (name === "command-loop") {
  await assert.rejects(setup({ limits: { maxLoopIterations: 3 } }).shell.exec("while command true; do :; done"), error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
} else if (name === "command-source") {
  const source = "command bash -c 'true'";
  await assert.rejects(setup({ limits: { maxSourceBytes: Buffer.byteLength(source) + 3 } }).shell.exec(source), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
} else if (name === "lookup-late-rejection") {
  const { fs, commands } = setup();
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "cancel lookup" });
  const wrapped = new Proxy(fs, { get(target, key) {
    if (key === "stat") return async () => new Promise((_resolve, reject) => { setTimeout(() => controller.abort(reason), 5); setTimeout(() => reject(new Error("late lookup rejection")), 25); });
    const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(new Shell({ fs: wrapped, commands }).exec("command -v absent", { signal: controller.signal }), error => error === reason);
  await new Promise(resolve => setTimeout(resolve, 40));
} else if (name === "read-cancel") {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "cancel exact read" });
  let returned = 0;
  const stdin = { [Symbol.asyncIterator]() { return {
    next: async () => new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { setTimeout(() => controller.abort(reason), 5); setTimeout(() => reject(new Error("late input rejection")), 25); }),
    return: async () => { returned++; return { done: true as const, value: undefined }; },
  }; } };
  await assert.rejects(setup().shell.exec("bash -c 'command read -N2 value'", { stdin, signal: controller.signal }), error => error === reason);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(returned, 1);
} else if (name === "read-empty-cancel") {
  const controller = new AbortController();
  const reason = new FsError("ECANCELED", { path: "empty chunks" });
  let returned = 0;
  const timer = setTimeout(() => controller.abort(reason), 10);
  const stdin = { async *[Symbol.asyncIterator]() { try { while (true) yield new Uint8Array(); } finally { returned++; } } };
  try { await assert.rejects(setup().shell.exec("read -N1 value", { stdin, signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(returned, 1);
} else if (name === "read-limit") {
  await assert.rejects(setup({ limits: { maxOutputBytes: 3 } }).shell.exec("read -N5 value", { stdin: "abcde" }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
} else if (name === "read-source") {
  const source = 'read -N2 value\nαβsay ok\n';
  const outer = "bash -s";
  await assert.rejects(setup({ limits: { maxSourceBytes: Buffer.byteLength(outer) + Buffer.byteLength(source) - Buffer.byteLength("αβ") - 1 } }).shell.exec(outer, { stdin: source }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
} else if (name === "read-loop") {
  await assert.rejects(setup({ limits: { maxLoopIterations: 3 } }).shell.exec("while read -N0 value; do :; done"), error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
} else if (name === "sh-depth") {
  await assert.rejects(setup({ limits: { maxSubstitutionDepth: 4 } }).shell.exec("sh -c 'fun() { fun; }; fun'"), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
} else if (name === "sh-source") {
  const source = "sh -c 'VALUE=é :; true'";
  await assert.rejects(setup({ limits: { maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength("VALUE=é :; true") - 1 } }).shell.exec(source), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
} else if (name === "sh-output") {
  await assert.rejects(setup({ limits: { maxOutputBytes: 3 } }).shell.exec("sh -c 'VALUE=new :; say $VALUE'"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
} else if (name === "sh-loop") {
  await assert.rejects(setup({ limits: { maxLoopIterations: 3 } }).shell.exec("sh -c 'while true; do VALUE=new :; done'"), error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
} else if (name === "sh-cancel") {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "cancel sh command" });
  commands.register({ name: "cancel", async execute(context) { assert.equal(context.env.VALUE, "new"); controller.abort(reason); throw reason; } });
  await assert.rejects(shell.exec("sh -c 'VALUE=new :; command cancel'", { signal: controller.signal }), error => error === reason);
} else throw new Error(`unknown probe ${name}`);
console.log(`PASS ${name}`);
