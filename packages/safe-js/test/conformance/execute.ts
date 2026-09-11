import type { BudgetOptions } from "../../src/interp/budget.js";
import { prepareTest262, type Test262Variant } from "./metadata.js";
import { createTest262Realm } from "./realm.js";
import { classifyScriptOutcome, type Test262Result } from "./result.js";

type ExecutionResult = Test262Result
  | { status: "failed"; reason: "harness-error" | "timeout" | "async-failure" }
  | { status: "unsupported"; reason: "module" | "blocking-mode" };

export async function executeTest262(filename: string, source: string, options: {
  harness: ReadonlyMap<string, string>;
  timeoutMs: number;
  budget?: BudgetOptions;
}): Promise<{ kind: "fixture" } | { kind: "test"; results: Array<ExecutionResult & { mode: Test262Variant["mode"] }> }> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error("Test262 timeout must be a positive finite duration");
  const prepared = prepareTest262(filename, source);
  if (prepared.kind === "fixture") return prepared;
  const results: Array<ExecutionResult & { mode: Test262Variant["mode"] }> = [];
  for (const variant of prepared.variants) {
    if (variant.mode === "module") {
      results.push({ mode: variant.mode, status: "unsupported", reason: "module" });
      continue;
    }
    if (prepared.flags.includes("CanBlockIsFalse") || prepared.flags.includes("CanBlockIsTrue")) {
      results.push({ mode: variant.mode, status: "unsupported", reason: "blocking-mode" });
      continue;
    }
    let complete!: () => void;
    const completion = new Promise<void>(resolve => { complete = resolve; });
    let asyncFailure = false;
    const configuredDeadline = options.budget?.deadline;
    const realm = createTest262Realm({ ...options.budget,
      deadline: Math.min(Date.now() + options.timeoutMs,
        configuredDeadline instanceof Date ? configuredDeadline.getTime() : configuredDeadline ?? Infinity)
    }, message => {
      if (message.startsWith("Test262:AsyncTestFailure:")) {
        asyncFailure = true;
        complete();
      } else if (message === "Test262:AsyncTestComplete") complete();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<ExecutionResult>(resolve => {
        timer = setTimeout(() => resolve({ status: "failed", reason: "timeout" }), options.timeoutMs);
      });
      const execution = (async (): Promise<ExecutionResult> => {
        for (const include of variant.harness) {
          const harnessSource = options.harness.get(include);
          if (harnessSource === undefined || (await realm.evaluate(harnessSource)).status !== "normal")
            return { status: "failed", reason: "harness-error" };
        }
        const outcome = await realm.evaluate(variant.source);
        const result = classifyScriptOutcome(outcome, prepared.negative);
        if (result.status === "failed") return result;
        if (prepared.flags.includes("async")) {
          await completion;
          if (asyncFailure) return { status: "failed", reason: "async-failure" };
        }
        return result;
      })();
      results.push({ mode: variant.mode, ...await Promise.race([execution, timeout]) });
    } finally {
      clearTimeout(timer);
      await realm.dispose();
    }
  }
  return { kind: "test", results };
}
