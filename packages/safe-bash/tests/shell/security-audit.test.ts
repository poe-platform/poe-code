import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { parseArithmetic } from "../../src/shell/arithmetic.js";
import { parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { registerYieldCheckpoint, yieldTurn } from "../../src/contracts/yield.js";
import { shellValueFromBytes, shellValueText } from "../../src/contracts/value.js";
import type { ShellValue } from "../../src/contracts/value.js";
import { Budget, resolveLimits, Runtime } from "../../src/shell/runtime.js";
import type { State } from "../../src/shell/runtime.js";
import type { ShellLimits } from "../../src/shell/types.js";
import { cloudflareWorkerLimits, ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

function ifsFixture(context: TestContext, value: string, limits: ShellLimits = {}, signal?: AbortSignal) {
  const budget = new Budget(resolveLimits({ maxExpansionBytes: 262144 }, limits), signal);
  const runtime = Object.assign(Object.create(Runtime.prototype) as Runtime, { budget, signal: budget.signal });
  registerYieldCheckpoint(budget.signal, () => budget.cpuCheckpoint());
  const state: State = {
    cwd: "/", variables: { value }, exported: new Set(), functions: new Map(), positional: [],
    status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false,
  };
  const word = { offset: 0, parts: [{ kind: "variable" as const, name: "value", quoted: false }] };
  const io = {} as Parameters<Runtime["word"]>[2];
  context.after(() => { budget.close(); budget.values.close(); });
  return { budget, runtime, state, word, io };
}

test("IFS assembles a 4096-character scalar as a bounded run", async context => {
  const { runtime, state, word, io } = ifsFixture(context, "a".repeat(4096));
  let appends = 0;
  const result = await runtime.word(word, state, io, true, false, false, false, () => { appends++; });
  assert.deepEqual(result, [state.variables.value]);
  assert.equal(appends, 1);
});

for (const separator of [" ", ":"]) {
  test(`IFS admits fields before allocation for ${JSON.stringify(separator)}`, async context => {
    const { runtime, state, word, io } = ifsFixture(context, `a${separator}`.repeat(128), { maxExpansionFields: 4 });
    state.variables.IFS = separator;
    const originalPush = Array.prototype.push;
    let maximumFields = 0;
    Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
      for (const item of items) {
        if (item && typeof item === "object" && "fragments" in item && "present" in item && item.present === false) maximumFields = Math.max(maximumFields, this.length + items.length);
      }
      return originalPush.apply(this, items);
    };
    try {
      await assert.rejects(runtime.word(word, state, io), error => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
    } finally { Array.prototype.push = originalPush; }
    assert.equal(maximumFields, 4, `allocated ${maximumFields} fields with cap 4`);
    assert.deepEqual(runtime.budget.values.usage, { bytes: 0, slots: 0 });
  });
}

for (const reason of [false, null]) {
  test(`IFS delimiter-free scanning yields and preserves cancellation ${String(reason)}`, async context => {
    const controller = new AbortController();
    const { runtime, state, word, io, budget } = ifsFixture(context, "a".repeat(16384), {}, controller.signal);
    let appended = 0;
    const pending = setImmediate(() => controller.abort(reason));
    context.after(() => clearImmediate(pending));
    await assert.rejects(runtime.word(word, state, io, true, false, false, false, text => { appended += text.length; }), error => error === reason);
    assert.ok(appended <= 4096, `appended ${appended} characters before cancellation`);
    assert.equal(budget.commands, 0);
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
  });
}

test("IFS scanner checkpoints byte runs and non-ASCII IFS without losing bytes", async context => {
  const { runtime, budget, io } = ifsFixture(context, "");
  const scanner = runtime as unknown as { splitValue(value: ShellValue, separators: ReadonlySet<number>, asciiSeparators: boolean, io: unknown): Iterable<ShellValue> | AsyncIterable<ShellValue> };
  const checkpoint = context.mock.method(budget, "cpuCheckpoint");
  for (const separators of [" ", "é"]) {
    const value = shellValueFromBytes(new TextEncoder().encode("a".repeat(16384)));
    let text = "";
    for await (const piece of scanner.splitValue(value, new Set([separators.codePointAt(0)!]), separators === " ", io)) text += shellValueText(piece);
    assert.equal(text, "a".repeat(16384));
  }
  assert.ok(checkpoint.mock.callCount() >= 8);
  assert.equal(budget.commands, 0);
});

test("IFS scalar scratch is admitted and released before word completion", async context => {
  const { runtime, state, word, io, budget } = ifsFixture(context, "a b c");
  let admitted = false;
  assert.deepEqual(await runtime.word(word, state, io, true, false, false, false, () => {
    admitted ||= budget.values.usage.bytes > 0;
  }), ["a", "b", "c"]);
  assert.equal(admitted, true);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});

test("IFS scalar scratch rejects before append when the arena is occupied", async context => {
  const { runtime, state, word, io, budget } = ifsFixture(context, "a b", { maxExpansionBytes: 256 });
  const retained = budget.values.hold("x".repeat(120));
  let appends = 0;
  await assert.rejects(runtime.word(word, state, io, true, false, false, false, () => { appends++; }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(appends, 0);
  assert.deepEqual(budget.values.usage, { bytes: 240, slots: 0 });
  retained.release();
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});

test("IFS short array members share a cooperative scan quantum", async context => {
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: "array splitting" });
  const prototype = Runtime.prototype as unknown as { splitValue(value: ShellValue, ...options: unknown[]): AsyncIterable<ShellValue> };
  const original = prototype.splitValue;
  let appended = 0;
  let pending: ReturnType<typeof setImmediate> | undefined;
  context.mock.method(prototype, "splitValue", async function*(this: Runtime, value: ShellValue, ...options: unknown[]) {
    pending ??= setImmediate(() => controller.abort(reason));
    for await (const piece of original.call(this, value, ...options)) {
      appended += shellValueText(piece).length;
      yield piece;
    }
  });
  context.after(() => { if (pending) clearImmediate(pending); });
  const { shell } = setup({ env: { value: "a".repeat(512) } });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec(`values=(${Array.from({ length: 32 }, () => '"$value"').join(" ")}); set -- \${values[@]}`, { signal: controller.signal }), error => error === reason);
  assert.ok(appended <= 4096, `scanned ${appended} array characters before cancellation`);
});

test("IFS CPU checkpoint failure releases scalar scratch without command charges", async context => {
  const { runtime, state, word, io, budget } = ifsFixture(context, "a".repeat(16384));
  let checkpoints = 0;
  context.mock.method(budget, "cpuCheckpoint", () => { if (++checkpoints === 2) budget.fail("maxCpuMs"); });
  await assert.rejects(runtime.word(word, state, io), error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
  assert.equal(checkpoints, 2);
  assert.equal(budget.commands, 0);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});

test("IFS scratch releases on assembly failure while retaining borrowed values", async context => {
  const { runtime, state, word, io, budget } = ifsFixture(context, "a b");
  const held = budget.values.hold("retained");
  const before = budget.values.usage;
  const reason = new Error("assembly observer");
  await assert.rejects(runtime.word(word, state, io, true, false, false, false, () => { throw reason; }), error => error === reason);
  assert.deepEqual(budget.values.usage, before);
  held.release();
});

test("IFS reuses a whole retained scalar without charging its payload twice", async context => {
  const { runtime, state, word, io, budget } = ifsFixture(context, "a".repeat(4096), { maxExpansionBytes: 8704 });
  const held = budget.values.hold(state.variables.value!);
  const before = budget.values.usage;
  assert.deepEqual(await runtime.word(word, state, io), [state.variables.value]);
  assert.deepEqual(budget.values.usage, before);
  held.release();
});

test("parser line lookup remains linear for token-heavy input", { timeout: 1_000 }, () => {
  const source = "a;".repeat(100_000);
  const started = performance.now();
  parseShellUnit(source, 0, false, new ParseBudget(2_000_000));
  assert.ok(performance.now() - started < 750);
});

test("Cloudflare Worker limits cap large per-invocation allocations", () => {
  assert.ok(cloudflareWorkerLimits.maxInputBytes <= 4 * 1024 * 1024);
  assert.ok(cloudflareWorkerLimits.maxOutputBytes <= 4 * 1024 * 1024);
  assert.ok(cloudflareWorkerLimits.maxExpansionBytes <= 4 * 1024 * 1024);
  assert.ok(cloudflareWorkerLimits.pipeHighWaterMark <= 16 * 1024);
  assert.ok(cloudflareWorkerLimits.maxWallClockMs <= 10_000);
});

test("based arithmetic literals truncate during parsing", { timeout: 500 }, () => {
  const started = performance.now();
  const parsed = parseArithmetic(`64#${"z".repeat(100_000)}`);
  assert.equal(parsed.kind, "literal");
  assert.ok(performance.now() - started < 400);
});

test("variable appends cannot retain values beyond the expansion byte limit", async () => {
  const { shell } = setup();
  await assert.rejects(shell.exec("value=12345678; value+=9", { limits: { maxExpansionBytes: 8 } }),
    error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
});

test("wall-clock limits abort commands that are awaiting host work", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "wait", async execute({ signal }) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 50);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("wait", { limits: { maxWallClockMs: 5 } }),
    error => error instanceof ShellLimitError && error.limit === "maxWallClockMs");
});

test("CPU limits are checked at cooperative yield points", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "busy", async execute({ signal }) {
    const until = performance.now() + 10;
    while (performance.now() < until) { /* bounded synthetic CPU burst */ }
    await yieldTurn(signal);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("busy", { limits: { maxCpuMs: 1 } }),
    error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
});

test("conditional ERE matching stays budgeted without a Worker transport", async () => {
  const { shell } = setup();
  const result = await shell.exec("if [[ abc123 =~ ^([a-z]+)([0-9]+)$ ]]; then say \"${BASH_REMATCH[1]}:${BASH_REMATCH[2]}\"; fi");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "abc:123\n");
  assert.equal(result.stderr, "");
});

test("separate tenant shells never share environment or filesystem state", async () => {
  const tenantA = setup({ env: { TENANT_TOKEN: "alpha" } });
  const tenantB = setup({ env: { TENANT_TOKEN: "beta" } });
  await Promise.all([
    tenantA.shell.exec("say alpha > /private"),
    tenantB.shell.exec("say beta > /private"),
  ]);
  const [aEnv, bEnv, aFile, bFile] = await Promise.all([
    tenantA.shell.exec("envget TENANT_TOKEN"),
    tenantB.shell.exec("envget TENANT_TOKEN"),
    tenantA.fs.readFile("/private"),
    tenantB.fs.readFile("/private"),
  ]);
  assert.equal(aEnv.stdout, "alpha");
  assert.equal(bEnv.stdout, "beta");
  assert.equal(new TextDecoder().decode(aFile), "alpha\n");
  assert.equal(new TextDecoder().decode(bFile), "beta\n");
});
