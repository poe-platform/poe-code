import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [candidate, output] = process.argv.slice(2);
assert(candidate && output, "Pass an immutable built candidate/package root and a new output file");
const { Shell, createMemoryFileSystem } = await import(pathToFileURL(join(candidate, "dist/index.js")).href);
const { columnCommands } = await import(pathToFileURL(join(candidate, "dist/commands/column/index.js")).href);
let enteredReturn, releaseReturn;
const entered = new Promise((resolve) => { enteredReturn = resolve; });
const released = new Promise((resolve) => { releaseReturn = resolve; });
let returns = 0, execSettled = false, disposeSettled = false;
const stdin = { [Symbol.asyncIterator]() { return {
  async next() { return { done: false, value: Buffer.from("a b\n") }; },
  async return() { returns++; enteredReturn(); await released; return { done: true }; },
}; } };
const host = new Shell({ fs: createMemoryFileSystem() });
host.use(columnCommands({ limits: { maxInputBytes: 1 } }));
const operation = host.exec("column -t", { stdin }).then((value) => { execSettled = true; return { status: value.exitCode, stdoutHex: Buffer.from(value.stdoutBytes).toString("hex"), stderrHex: Buffer.from(value.stderrBytes).toString("hex") }; }, (error) => { execSettled = true; return { rejection: String(error) }; });
const tick = () => new Promise((resolve) => setImmediate(resolve));
let disposal;
const record = { classification: "root-owned-hidden-external-stdin-return-boundary", candidate };
try {
  await entered;
  await tick(); await tick();
  disposal = host.dispose().then(() => { disposeSettled = true; });
  await tick(); await tick();
  record.beforeGateRelease = { returns, execSettled, disposeSettled };
  record.acceptance = execSettled || disposeSettled ? "HOLD" : "barrier-observed";
} finally {
  releaseReturn();
  record.outcome = await operation;
  await disposal;
  await host.dispose();
  record.finallyReleasedHarnessGate = true;
}
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(record));
if (record.acceptance === "HOLD") process.exitCode = 1;
