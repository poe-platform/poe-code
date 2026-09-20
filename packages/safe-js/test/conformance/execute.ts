import { Test262Agents } from "./agents.js";
import type {SourceResolver} from "../../src/modules/source-graph.js";
import type { BudgetOptions } from "../../src/interp/budget.js";
import { prepareTest262, type Test262Variant } from "./metadata.js";
import { createTest262Realm } from "./realm.js";
import { classifyScriptOutcome, type Test262Result } from "./result.js";

type ExecutionResult = Test262Result
  | { status: "failed"; reason: "harness-error" | "timeout" | "async-failure" | "unhandled-rejection"; detail?: string | Record<string, string> }
  | { status: "unsupported"; reason: "module" | "blocking-mode" | "agent" | "shared-memory" | "IsHTMLDDA" | "gc" };

export async function executeTest262(filename: string, source: string, options: {
  harness: ReadonlyMap<string, string>;
  sourceResolver?: SourceResolver;
  timeoutMs: number;
  budget?: BudgetOptions;
  mode?: Test262Variant["mode"];
}): Promise<{ kind: "fixture" } | { kind: "test"; results: Array<ExecutionResult & { mode: Test262Variant["mode"] }> }> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error("Test262 timeout must be a positive finite duration");
  const prepared = prepareTest262(filename, source);
  if (prepared.kind === "fixture") return prepared;
  if (options.mode !== undefined && !prepared.variants.some(variant => variant.mode === options.mode))
    throw new Error("Requested Test262 mode is not enumerated");
  const results: Array<ExecutionResult & { mode: Test262Variant["mode"] }> = [];
  for (const variant of prepared.variants) {
    if (options.mode !== undefined && variant.mode !== options.mode) continue;
    if (prepared.negative?.phase !== "parse" &&
        (prepared.features.some(feature => ["import-defer", "source-phase-imports", "source-phase-imports-module-source"].includes(feature)) ||
        (prepared.features.includes("dynamic-import") && options.sourceResolver === undefined))) {
      results.push({ mode: variant.mode, status: "unsupported", reason: "module" });
      continue;
    }
    const requirement = variant.harness.includes("agent.js") ? "agent"
      : prepared.features.includes("IsHTMLDDA") ? "IsHTMLDDA" : undefined;
    if (requirement !== undefined) {
      results.push({ mode: variant.mode, status: "unsupported", reason: requirement });
      continue;
    }
    let complete!: () => void;
    const completion = new Promise<void>(resolve => { complete = resolve; });
    let asyncFailure = false;
    let completionCount = 0;
    const configuredDeadline = options.budget?.deadline;
    const agentBudget = { ...options.budget, deadline: Math.min(Date.now() + options.timeoutMs,
      configuredDeadline instanceof Date ? configuredDeadline.getTime() : configuredDeadline ?? Infinity) };
    const agentFailure: { error?: Error } = {};
    const onAgentError = (error: unknown) => {
      agentFailure.error = error instanceof Error ? error : new Error(JSON.stringify(
        classifyScriptOutcome({ status: "throw", phase: "runtime", error })));
      complete();
    };
    const agents = new Test262Agents(agentBudget, onAgentError);
    const readAgentFailure = () => agentFailure.error;
    const realm = createTest262Realm({ ...options.budget,
      deadline: Math.min(Date.now() + options.timeoutMs,
        configuredDeadline instanceof Date ? configuredDeadline.getTime() : configuredDeadline ?? Infinity)
    }, message => {
      if (message.startsWith("Test262:AsyncTestFailure:")) {
        asyncFailure = true;
        complete();
      } else if (message === "Test262:AsyncTestComplete") {
        completionCount += 1;
        if (completionCount > 1) asyncFailure = true;
        complete();
      }
    }, undefined, {resolver:options.sourceResolver,filename}, { agent: agents, canBlock: !prepared.flags.includes("CanBlockIsFalse"), onError: onAgentError });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<ExecutionResult>(resolve => {
        timer = setTimeout(() => resolve({ status: "failed", reason: "timeout" }), options.timeoutMs);
      });
      const execution = (async (): Promise<ExecutionResult> => {
        for (const include of variant.harness) {
          const harnessSource = options.harness.get(include);
          if (harnessSource === undefined)
            return { status: "failed", reason: "harness-error", detail: `Missing harness include: ${include}` };
          const harnessOutcome = await realm.evaluate(harnessSource);
          if (harnessOutcome.status !== "normal")
            return { status: "failed", reason: "harness-error", detail: { include, ...((classifyScriptOutcome(harnessOutcome) as { detail?: Record<string, string> }).detail ?? {}) } };
        }
        const outcome = prepared.flags.includes("module") ? await realm.evaluateModule(variant.source,filename)
          : await realm.evaluate(variant.source);
        if (realm.unsupportedCapabilities.has("source-resolution")) return {status:"unsupported",reason:"module"};
        if (realm.unsupportedCapabilities.has("gc")) return { status: "unsupported", reason: "gc" };
        if (agentFailure.error) return { status: "failed", reason: "host-error", detail: { message: agentFailure.error.message } };
        const result = classifyScriptOutcome(outcome, prepared.negative);
        if (result.status === "failed") return result;
        if (prepared.flags.includes("async")) {
          await completion;
          if (asyncFailure) return { status: "failed", reason: "async-failure" };
        }
        const settlement = await realm.settle();
        if (realm.unsupportedCapabilities.has("gc")) return { status: "unsupported", reason: "gc" };
        if (settlement.status !== "normal") {
          const failure = classifyScriptOutcome(settlement);
          return { status: "failed", reason: settlement.status === "host-error" ? "host-error" : "unhandled-rejection",
            ...(failure.status === "failed" ? { detail: failure.detail } : {}) };
        }
        const settledAgentFailure = readAgentFailure();
        if (settledAgentFailure) return { status: "failed", reason: "host-error", detail: { message: settledAgentFailure.message } };
        if (asyncFailure) return { status: "failed", reason: "async-failure" };
        return result;
      })();
      results.push({ mode: variant.mode, ...await Promise.race([execution, timeout]) });
    } finally {
      clearTimeout(timer);
      await Promise.all([realm.dispose(), agents.dispose()]);
    }
  }
  return { kind: "test", results };
}
