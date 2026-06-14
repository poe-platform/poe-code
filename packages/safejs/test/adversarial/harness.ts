import { performance } from "node:perf_hooks";

import { formatInterpreterError } from "../../src/error/format.js";
import { Budget, SandboxError } from "../../src/interp/budget.js";
import { createGeneratorChannel } from "../../src/interp/generator.js";
import { matchRegex } from "../../src/interp/regex/engine.js";
import { parseRegex } from "../../src/interp/regex/parse.js";
import { lint } from "../../src/lint.js";
import { parse } from "../../src/parse.js";
import { run } from "../../src/run.js";
import { SnapshotBudgetError } from "../../src/graph-depth.js";
import { dump } from "../../src/dump.js";
import { adversarialFailure } from "./report.js";

export const ADVERSARIAL_CORPUS_SEED = 0xad5c_2026;
const MAX_DURATION_MS = 750;

export async function runAdversarialCorpus(): Promise<void> {
  const startedAt = performance.now();
  await assertDeterministicCompletion(
    "return [1, 2, 3].map((value) => value * 2).join(',');",
    "2,4,6"
  );
  assertDocumentedParserFailure("const value = ;");
  await assertSandboxFailure(
    "function recurse(value) { return recurse(value + 1); } return recurse(0);",
    new Budget({ maxCallDepth: 24 }),
    "callDepth"
  );
  assertRegexBudgetFailure();
  await assertPromiseLifecycle();
  await assertIteratorReentry();
  assertCircularModuleLint();
  await assertUnregisteredModuleCannotExecute();
  await assertResourceExhaustion();
  assertFailureFormattingCannotRecurseForever();
  await assertSnapshotDepthIsTyped();

  const duration = performance.now() - startedAt;
  if (duration > MAX_DURATION_MS) {
    throw adversarialFailure({
      cause: new Error(`corpus exceeded ${MAX_DURATION_MS}ms: ${duration.toFixed(1)}ms`),
      kind: "source",
      seed: ADVERSARIAL_CORPUS_SEED,
      value: "<fast adversarial corpus>"
    });
  }
}

async function assertDeterministicCompletion(source: string, expected: unknown): Promise<void> {
  const first = await run(source);
  const second = await run(source);
  if (
    !first.ok ||
    !second.ok ||
    first.returnValue !== expected ||
    second.returnValue !== expected
  ) {
    throw adversarialFailure({
      cause: new Error("completion was not deterministic"),
      kind: "source",
      seed: ADVERSARIAL_CORPUS_SEED,
      value: source
    });
  }
}

function assertDocumentedParserFailure(source: string): void {
  try {
    parse(source);
    throw new Error("invalid source parsed successfully");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !["ParseError", "DisallowedSyntaxError", "SyntaxError"].includes(error.name)
    ) {
      throw adversarialFailure({
        cause: error,
        kind: "source",
        seed: ADVERSARIAL_CORPUS_SEED,
        value: source
      });
    }
  }
}

async function assertSandboxFailure(
  source: string,
  budget: Budget,
  budgetName: string
): Promise<void> {
  try {
    await run(source, { budget });
    throw new Error("resource attack completed without a sandbox error");
  } catch (error) {
    if (
      !(error instanceof SandboxError) ||
      error.code !== "budgetExceeded" ||
      error.budget !== budgetName
    ) {
      throw adversarialFailure({
        cause: error,
        kind: "source",
        seed: ADVERSARIAL_CORPUS_SEED,
        value: source
      });
    }
  }
}

function assertRegexBudgetFailure(): void {
  try {
    matchRegex(parseRegex("(a+)+b"), `${"a".repeat(28)}X`);
    throw new Error("pathological regex completed without exhausting its budget");
  } catch (error) {
    if (!(error instanceof SandboxError) || error.code !== "budgetExceeded") {
      throw adversarialFailure({
        cause: error,
        kind: "source",
        seed: ADVERSARIAL_CORPUS_SEED,
        value: "/(a+)+b/.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaX')"
      });
    }
  }
}

async function assertPromiseLifecycle(): Promise<void> {
  await assertDeterministicCompletion(
    "return await Promise.race([Promise.resolve('first'), Promise.resolve('second')]);",
    "first"
  );
  await assertDeterministicCompletion(
    "try { await Promise.any([Promise.reject('left'), Promise.reject('right')]); } catch (error) { return error.name; }",
    "AggregateError"
  );
}

async function assertIteratorReentry(): Promise<void> {
  const holder: { channel?: ReturnType<typeof createGeneratorChannel> } = {};
  const channel = createGeneratorChannel(async (yieldValue) => {
    try {
      await holder.channel?.next();
      throw new Error("iterator re-entry was accepted");
    } catch (error) {
      if (!(error instanceof SandboxError) || error.code !== "reentry") throw error;
    }
    await yieldValue("safe");
    return "done";
  });
  holder.channel = channel;
  const first = await channel.next();
  const second = await channel.next();
  if (first.value !== "safe" || first.done || second.value !== "done" || !second.done) {
    throw adversarialFailure({
      cause: new Error("iterator did not recover after re-entry"),
      kind: "source",
      seed: ADVERSARIAL_CORPUS_SEED,
      value: "generator.next() during active next()"
    });
  }
}

function assertCircularModuleLint(): void {
  const alpha = 'import { run } from "beta"; return run();';
  const beta = 'import { start } from "alpha"; return start();';
  const diagnostics = lint(alpha, {
    filename: "/alpha.ajs",
    modules: {
      alpha: { exports: ["start"], filename: "/alpha.ajs", source: alpha },
      beta: { exports: ["run"], filename: "/beta.ajs", source: beta }
    }
  });
  if (!diagnostics.some((diagnostic) => diagnostic.code === "AS-IMPORT-CYCLE")) {
    throw adversarialFailure({
      cause: new Error("circular module graph was not linted"),
      kind: "source",
      seed: ADVERSARIAL_CORPUS_SEED,
      value: alpha
    });
  }
}

async function assertUnregisteredModuleCannotExecute(): Promise<void> {
  const source = 'import { run } from "unregistered"; return run();';
  try {
    await run(source, { modules: {} });
    throw new Error("unregistered module executed");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Unknown module 'unregistered'")) {
      throw adversarialFailure({
        cause: error,
        kind: "source",
        seed: ADVERSARIAL_CORPUS_SEED,
        value: source
      });
    }
  }
}

async function assertResourceExhaustion(): Promise<void> {
  await assertSandboxFailure(
    "let total = 0; while (true) { total += 1; }",
    new Budget({ maxSteps: 500 }),
    "steps"
  );
  await assertSandboxFailure(
    "return 'x'.repeat(10_000);",
    new Budget({ stringLength: 128 }),
    "stringLength"
  );
}

function assertFailureFormattingCannotRecurseForever(): void {
  const error = new Error("outer") as Error & { cause?: unknown };
  error.cause = error;
  const formatted = formatInterpreterError(error);
  if (!formatted.includes("[Circular cause]") || formatted.includes(process.cwd())) {
    throw adversarialFailure({
      cause: new Error("failure formatting leaked or recursed"),
      kind: "source",
      seed: ADVERSARIAL_CORPUS_SEED,
      value: "throw circular error cause"
    });
  }
}

async function assertSnapshotDepthIsTyped(): Promise<void> {
  let value: Record<string, unknown> = {};
  const snapshot = { sourceHash: "hash", value };
  for (let depth = 0; depth < 1_030; depth += 1) {
    const next: Record<string, unknown> = {};
    value.next = next;
    value = next;
  }
  try {
    await dump({ snapshot } as never);
    throw new Error("deep snapshot was accepted");
  } catch (error) {
    if (!(error instanceof SnapshotBudgetError)) {
      throw adversarialFailure({
        cause: error,
        kind: "snapshot",
        seed: ADVERSARIAL_CORPUS_SEED,
        value: "deep snapshot graph"
      });
    }
  }
}
