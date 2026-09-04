import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { parseArithmetic } from "../../src/shell/arithmetic.js";
import { parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { yieldTurn } from "../../src/contracts/yield.js";
import { cloudflareWorkerLimits, ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

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
