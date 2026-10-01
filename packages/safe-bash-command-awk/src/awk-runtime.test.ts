import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-io-engine/commands/text-programs/shared";
import { Reader } from "./awk-reader.js";
import { AwkRuntime } from "./awk-runtime.js";
import { AwkParser, builtinArities } from "./awk-syntax.js";
import { AwkRetention } from "./awk-retention.js";

async function runtime(source: string, onOutput?: (text: string, retained: number) => void) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("first\nsecond\n"));
  const retention = new AwkRetention(4096);
  let stdout = "";
  const argumentValues = createCommandArguments([]);
  const context: CommandContext = {
    command: "awk", args: [], argumentValues, cwd: "/", env: {}, fs, stdin: toByteSource(""),
    stdout: { async write(bytes) {
      const output = new TextDecoder().decode(bytes);
      stdout += output;
      onOutput?.(output, retention.retainedBytes);
    } },
    stderr: { async write() {} }, signal: new AbortController().signal,
  };
  const budget = new Budget(context, {});
  // Keep the initial execution synchronous; explicit redirected writes suspend it.
  budget.checkpointSync = () => undefined;
  const instance = new AwkRuntime(new AwkParser(source, builtinArities).parse(), context, budget, retention, ["/input"], []);
  return { instance, stdout: () => stdout };
}

for (const [args, expected] of [
  ['(OFS=":"), "b"', "::b\n"],
  ['"a", (ORS="!\\n")', "a !\n!\n"],
  ['(OFMT="%.2f"), 1/3', "%.2f 0.33\n"],
  ['1/3, (OFMT="%.2f"), 1/3', "0.333333 %.2f 0.33\n"],
]) test(`synchronous print evaluation: ${args}`, async () => {
  const run = await runtime(`{ print ${args}; exit }`);
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(run.stdout(), expected);
});

for (const rules of [
  '{ print "suspend" > "/dev/stdout"; exit }',
  '{ print "suspend" > "/dev/stdout" } { exit }',
]) test(`release input before END after asynchronous rule: ${rules}`, async t => {
  let checked = false, closed = false;
  const close = Reader.prototype.close;
  t.mock.method(Reader.prototype, "close", function (this: Reader) {
    closed = true;
    return close.call(this);
  });
  const run = await runtime(`${rules} END { print "end" > "/dev/stdout" }`, (output) => {
    if (output.includes("end\n")) { checked = true; assert.equal(closed, true); }
  });
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(checked, true);
});

test("END getline keeps the main input alive after asynchronous exit", async () => {
  const run = await runtime('{ print "suspend" > "/dev/stdout"; exit } END { getline; print $0 }');
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(run.stdout(), "suspend\nsecond\n");
});

for (const args of ['f(), 1/3', '1/3, f(), 1/3']) test(`print resumes argument formatting after suspension: ${args}`, async () => {
  const run = await runtime(`function f() { print "pause" > "/dev/stdout"; OFS=":"; ORS="!"; OFMT="%.2f"; return 1/3 } { print ${args}; exit }`);
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(run.stdout(), args.startsWith('f') ? "pause\n0.33:0.33!" : "pause\n0.333333:0.33:0.33!");
});
