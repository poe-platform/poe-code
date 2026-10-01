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
  return { instance, budget, context, retention, stdout: () => stdout };
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

test("aborted awk releases the budget context before propagating cancellation", async () => {
  const controller = new AbortController();
  const run = await runtime('{ print $0 > "/dev/stdout" }', () => controller.abort(new Error("cancelled")));
  run.context.env.SECRET_KEY = "tenant-secret";
  Object.assign(run.context, { signal: controller.signal });
  await assert.rejects(async () => await run.instance.runSyncOrAsync(), /cancelled/);
  const retained = run.budget as unknown as { context: CommandContext; signal: AbortSignal };
  assert.notEqual(retained.context, run.context);
  assert.equal(retained.signal.aborted, false);
});

for (const [args, expected] of [
  ['++x, -1', '1 -1'],
  ['++x, 1.5', '1 1.5'],
  ['++x, "' + 'a'.repeat(241) + '"', '1 ' + 'a'.repeat(241)],
  ['++x, (x += 10), -1', '1 11 -1'],
  ['++x, sub(/first/, "changed"), -1', '1 1 -1'],
] as const) test(`print evaluates side effects once: ${args}`, async () => {
  const run = await runtime(`{ print ${args}; print x; exit }`);
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(run.stdout(), `${expected}\n${args.includes('x +=') ? 11 : 1}\n`);
});

for (const statement of [
  'print ++x, (getline line < "/input"), line',
  'printf "%d %d:%s\\n", ++x, (getline line < "/input"), line',
]) test(`output resumes getline without repeating arguments: ${statement}`, async () => {
  const run = await runtime(`{ ${statement}; print x; exit }`);
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(run.stdout(), statement.startsWith('printf') ? '1 1:first\n1\n' : '1 1 first\n1\n');
});

for (const program of [
  '{ print $1 }',
  '{ sum[$1]++; } END { print sum["first"] }',
  'END { print ENVIRON["TENANT"] }',
  'BEGIN { FS=":"; OFS="::"; ORS="!"; RS="\\n"; SUBSEP="key"; OFMT="%.2f"; CONVFMT="%.3f" } { print $1 }',
]) test(`awk releases the entire retention ledger after ${program}`, async () => {
  for (let invocation = 0; invocation < 3; invocation++) {
    const run = await runtime(program);
    run.context.env.TENANT = `tenant-${invocation}`;
    assert.equal(await run.instance.runSyncOrAsync(), 0);
    assert.equal(run.retention.retainedBytes, 0);
  }
});

for (const initial of [0, 5000]) {
  for (const [statement, expected] of [
    ['print "add:", (x + (++x))', `add: ${2 * initial + 3}\n`],
    ['print "sub:", (x - (x += 10))', 'sub: -10\n'],
    ['print "print:", x, ++x', `print: ${initial + 1} ${initial + 2}\n`],
    ['printf "printf: %d %d\\n", x, ++x', `printf: ${initial + 1} ${initial + 2}\n`],
  ]) test(`numeric updates preserve earlier operands: ${initial}; ${statement}`, async () => {
    const run = await runtime(`BEGIN { x = ${initial}; x++; ${statement} }`);
    assert.equal(await run.instance.runSyncOrAsync(), 0);
    assert.equal(run.stdout(), expected);
  });
}

for (const [update, next] of [
  ['++x', 5002], ['--x', 5000], ['x++', 5001], ['x--', 5001],
  ['x += 10', 5011], ['x -= 10', 4991], ['x *= 2', 10002],
  ['x /= 3', 1667], ['x %= 10', 1], ['x ^= 2', 25010001],
] as const) test(`numeric update preserves aliases and operands: ${update}`, async () => {
  const run = await runtime(`BEGIN { x = 5000; x++; saved = x; printf "%d %d %d\\n", x, (${update}), saved }`);
  assert.equal(await run.instance.runSyncOrAsync(), 0);
  assert.equal(run.stdout(), `5001 ${next} 5001\n`);
});
