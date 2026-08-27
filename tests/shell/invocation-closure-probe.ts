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
} else throw new Error(`unknown probe ${name}`);
console.log(`PASS ${name}`);
