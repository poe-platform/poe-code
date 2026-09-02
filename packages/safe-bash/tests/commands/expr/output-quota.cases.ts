import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { Budget, ExprError, type ExprLimits } from "../../../src/commands/expr/internal.js";
import { RegexExecutor, RegexExecutionError, RegexSession } from "../../../src/commands/regex-execution/client.js";
import type { InvocationCleanup } from "../../../src/contracts/command.js";
import { deferred, run } from "./helpers.js";

const emergency = "expr: output bytes limit exceeded\n";
const scenarios: readonly { name: string; args: readonly string[]; message: string; status: number; limits?: Partial<ExprLimits> }[] = [
  { name: "syntax", args: ["1", "x"], message: "syntax error: unexpected argument 'x'", status: 2 },
  { name: "division", args: ["1", "/", "0"], message: "division by zero", status: 2 },
  { name: "modulo", args: ["1", "%", "0"], message: "division by zero", status: 2 },
  { name: "noninteger", args: ["bad", "+", "1"], message: "non-integer argument", status: 2 },
  { name: "NUL", args: ["bad\0token"], message: "NUL is not supported in argv", status: 2 },
  { name: "Unicode", args: ["\ud800"], message: "argv must contain well-formed Unicode", status: 2 },
  { name: "argument resource", args: ["abc"], message: "aggregate argument bytes limit exceeded", status: 3, limits: { maxArgumentBytes: 1 } },
  { name: "work resource", args: ["1"], message: "evaluation work limit exceeded", status: 3, limits: { maxSteps: 1 } },
  { name: "string resource", args: ["abc"], message: "string allocation limit exceeded", status: 3, limits: { maxStringBytes: 1 } },
  { name: "worker syntax", args: ["a", ":", "["], message: "Invalid regular expression", status: 2 },
  { name: "worker resource", args: ["a", ":", "a"], message: "regex allocation limit exceeded", status: 3, limits: { maxRegexAllocatedUnits: 1 } },
];

for (const scenario of scenarios) {
  const normal = `expr: ${scenario.message}\n`;
  for (const cap of [1, Buffer.byteLength(normal) - 1, Buffer.byteLength(normal)]) {
    test(`normal diagnostic admission: ${scenario.name}, cap ${cap}`, { timeout: 10000 }, async () => {
      const result = await run(scenario.args, { limits: { ...scenario.limits, maxOutputBytes: cap } });
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, cap < Buffer.byteLength(normal) ? emergency : normal);
      assert.equal(result.exitCode, cap < Buffer.byteLength(normal) ? 3 : scenario.status);
    });
  }
}

for (const cap of [1, 2]) {
  test(`stdout remains bounded at cap ${cap}`, async () => {
    const result = await run(["1"], { limits: { maxOutputBytes: cap } });
    assert.equal(result.stdout, cap === 1 ? "" : "1\n");
    assert.equal(result.stderr, cap === 1 ? emergency : "");
    assert.equal(result.exitCode, cap === 1 ? 3 : 0);
  });
}

for (const cap of [1, 33, 34]) {
  test(`unknown internal error admission at cap ${cap}`, async context => {
    context.mock.method(Budget.prototype, "arguments", () => { throw undefined; });
    const result = await run(["1"], { limits: { maxOutputBytes: cap } });
    const normal = "expr: execution or output failure\n";
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, cap < Buffer.byteLength(normal) ? emergency : normal);
    assert.equal(result.exitCode, 3);
  });
}

for (const cap of [1, 30, 31]) {
  test(`worker transport diagnostic uses UTF-8 bytes at cap ${cap}`, async context => {
    const error = new RegexExecutionError("WORKER_ERROR", "💣");
    context.mock.method(RegexSession.prototype, "matchExpr", async () => { throw error; });
    const normal = `expr: ${error.message}\n`;
    const result = await run(["a", ":", "a"], { limits: { maxOutputBytes: cap } });
    assert.equal(result.stderr, cap < Buffer.byteLength(normal) ? emergency : normal);
    assert.equal(result.exitCode, 3);
  });
}

test("oversized host diagnostic is not encoded before quota admission", async context => {
  const message = "ATTACKER💣".repeat(100000);
  context.mock.method(RegexSession.prototype, "matchExpr", async () => { throw new ExprError(message); });
  const encodedSizes: number[] = [];
  const encode = TextEncoder.prototype.encode;
  context.mock.method(TextEncoder.prototype, "encode", function (this: InstanceType<typeof TextEncoder>, input?: string) {
    encodedSizes.push(input?.length ?? 0);
    assert((input?.length ?? 0) <= 34);
    return encode.call(this, input);
  });
  const result = await run(["a", ":", "a"], { limits: { maxOutputBytes: 1 } });
  assert.equal(result.stderr, emergency);
  assert(encodedSizes.includes(34));
});

for (const token of ["ATTACKER_MARKER", "'\\\n\t", "💣", "x".repeat(256)]) {
  test(`emergency is fixed, not user-controlled: ${JSON.stringify(token.slice(0, 16))}`, async () => {
    const attempts: Uint8Array[] = [];
    const result = await run(["1", token], { limits: { maxOutputBytes: 1 } }, {
      command: "ATTACKER_COMMAND", stderr: { async write(chunk) { attempts.push(new Uint8Array(chunk)); } },
    });
    assert.equal(result.exitCode, 3);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.byteLength, 34);
    assert.equal(Buffer.from(attempts[0]!).toString(), emergency);
  });
}

const reasons: readonly unknown[] = [new Error("sink"), new ExprError("output bytes limit exceeded", 3), undefined, null, false, 0, ""];
for (const channel of ["stdout", "normal-stderr", "emergency-stderr"] as const) {
  for (const [index, reason] of reasons.entries()) {
    test(`${channel} rejection ${index} keeps identity without fallback`, async () => {
      const attempts: string[] = [];
      const sink = { async write() { attempts.push(channel); throw reason; } };
      const result = await run(channel === "stdout" ? ["1"] : ["1", "/", "0"], {
        limits: { maxOutputBytes: channel === "stdout" ? 2 : channel === "normal-stderr" ? 23 : 1 },
      }, {
        stdout: channel === "stdout" ? sink : { async write() { assert.fail("unexpected stdout"); } },
        stderr: channel === "stdout" ? { async write() { assert.fail("sink failure became diagnostic"); } } : sink,
      }).then(() => ({ rejected: false, reason: undefined }), failure => ({ rejected: true, reason: failure as unknown }));
      assert.equal(result.rejected, true);
      assert.equal(result.reason, reason);
      assert.deepEqual(attempts, [channel]);
    });
  }
}

for (const channel of ["stdout", "normal-stderr", "emergency-stderr"] as const) {
  test(`${channel} awaits sink and overlapping registered cleanup`, { timeout: 10000 }, async context => {
    const entered = deferred(), gate = deferred(), retirement = deferred();
    const cleanups: InvocationCleanup[] = [];
    const events: string[] = [];
    const open = RegexExecutor.prototype.open;
    context.mock.method(RegexExecutor.prototype, "open", function (this: RegexExecutor, signal: AbortSignal) {
      events.push("open");
      return open.call(this, signal);
    });
    const close = RegexSession.prototype.close;
    let closes = 0;
    context.mock.method(RegexSession.prototype, "close", async function (this: RegexSession) {
      closes++;
      await retirement.promise;
      await close.call(this);
    });
    let attempts = 0, settled = false;
    const sink = { async write() { attempts++; entered.resolve(); await gate.promise; } };
    const invocation = run(channel === "stdout" ? ["1"] : ["1", "/", "0"], {
      limits: { maxOutputBytes: channel === "stdout" ? 2 : channel === "normal-stderr" ? 23 : 1 },
    }, {
      registerCleanup(cleanup) { events.push("register"); cleanups.push(cleanup); },
      ...(channel === "stdout" ? { stdout: sink } : { stderr: sink }),
    }).finally(() => { settled = true; });
    try {
      await entered.promise;
      assert.deepEqual(events, ["register", "open"]);
      assert.equal(settled, false);
      const first = cleanups[0]!(), second = cleanups[0]!();
      assert.equal(first, second);
      gate.resolve();
      await tick();
      assert.equal(settled, false);
      retirement.resolve();
      await Promise.all([first, second, invocation]);
      await cleanups[0]!();
      assert.equal(closes, 1);
      assert.equal(attempts, 1);
    } finally {
      gate.resolve(); retirement.resolve();
      await invocation;
    }
  });
}

for (const reason of [null, false, 0, "", Object.assign(new Error("caller"), { code: "ENOENT" })]) {
  for (const channel of ["stdout", "normal-stderr", "emergency-stderr"] as const) {
    test(`${channel} caller abort ${String(reason)} keeps exact reason`, { timeout: 10000 }, async () => {
      const controller = new AbortController();
      const entered = deferred();
      let rejectSink!: (reason: unknown) => void;
      const held = new Promise<void>((_resolve, reject) => { rejectSink = reject; });
      let attempts = 0;
      const sink = { async write() { attempts++; entered.resolve(); await held; } };
      const invocation = run(channel === "stdout" ? ["1"] : ["1", "/", "0"], {
        limits: { maxOutputBytes: channel === "stdout" ? 2 : channel === "normal-stderr" ? 23 : 1 },
      }, { signal: controller.signal, ...(channel === "stdout" ? { stdout: sink } : { stderr: sink }) })
        .then(() => ({ rejected: false, reason: undefined }), failure => ({ rejected: true, reason: failure as unknown }));
      try {
        await entered.promise;
        controller.abort(reason);
        const outcome = await invocation;
        assert.equal(outcome.rejected, true);
        assert.equal(outcome.reason, reason);
        assert.equal(attempts, 1);
      } finally {
        rejectSink(new Error("late sink rejection"));
        await invocation;
        await tick();
      }
    });
  }
}
