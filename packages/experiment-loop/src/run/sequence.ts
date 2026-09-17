import path from "node:path";
import {
  createRunQueue,
  makeRunLogFileName,
  resolveWorkflowPath,
  type RunQueue,
  type RunQueueOutcome,
  type RunQueueSnapshot
} from "@poe-code/agent-harness-tools";
import type { AgentRunInput, AgentRunResult, ExperimentRunOptions, ExperimentRunResult } from "../types.js";
import { runExperimentLoop } from "./loop.js";

export interface ExperimentSequenceOptions extends Omit<ExperimentRunOptions, "docPath"> {
  docs?: readonly string[];
  queue?: RunQueue;
  afterEachPlan?: readonly string[];
  onQueueChange?: (snapshot: RunQueueSnapshot) => void;
  runPlan?: (options: ExperimentRunOptions) => Promise<ExperimentRunResult>;
}

export interface ExperimentSequenceResult {
  status: RunQueueOutcome;
  plans: ExperimentRunResult[];
  messages: Array<{ text: string; planPath: string; result: AgentRunResult }>;
  queue: RunQueueSnapshot;
}

export async function runExperimentSequence(options: ExperimentSequenceOptions): Promise<ExperimentSequenceResult> {
  if (options.queue && (options.docs || options.afterEachPlan)) {
    throw new Error("Supply a queue or docs and afterEachPlan, not both.");
  }
  const runAgent = options.runAgent;
  if (!runAgent) throw new Error("runExperimentSequence requires a runAgent implementation.");
  const queue = options.queue ?? createRunQueue({
    plans: options.docs ?? [], afterEachPlan: options.afterEachPlan, cwd: options.cwd
  });
  const plans: ExperimentRunResult[] = [];
  const messages: ExperimentSequenceResult["messages"] = [];
  const unsubscribe = options.onQueueChange ? queue.onChange(options.onQueueChange) : undefined;
  options.onQueueChange?.(queue.getSnapshot());
  const {
    docs: ignoredDocs, queue: ignoredQueue, afterEachPlan: ignoredMessages,
    onQueueChange: ignoredChange, runPlan = runExperimentLoop, ...runOptions
  } = options;
  let lastInput: Omit<AgentRunInput, "prompt"> | undefined;
  try {
    const snapshot = await queue.run({
      signal: options.signal,
      async execute(item) {
        if (item.kind === "plan") {
          lastInput = undefined;
          const result = await runPlan({
            ...runOptions, docPath: item.path,
            additionalManagedPaths: [
              ...(runOptions.additionalManagedPaths ?? []),
              ...queue.getSnapshot().items.flatMap((entry) => {
                if (entry.kind !== "plan") return [];
                const docPath = resolveWorkflowPath(entry.path, options.cwd, options.homeDir);
                return [docPath, path.join(path.dirname(docPath), `${path.basename(docPath, path.extname(docPath))}.journal.jsonl`)];
              })
            ],
            async onPlanResolved(summary) {
              lastInput = {
                agent: summary.agent, model: summary.model, logDir: summary.logDir,
                cwd: runOptions.cwd, signal: runOptions.signal,
                runtime: runOptions.runtime, runtimeImage: runOptions.runtimeImage,
                detach: runOptions.detach, mountPoeCode: runOptions.mountPoeCode, runnerSync: runOptions.runnerSync
              };
              await options.onPlanResolved?.(summary);
            },
            async runAgent(input) {
              lastInput = input;
              return await runAgent(input);
            }
          });
          plans.push(result);
          return result.stopReason === "cancelled" ? "cancelled" : "completed";
        }
        const plan = queue.getSnapshot().items.find((entry) => entry.id === item.afterPlanId);
        if (!plan || plan.kind !== "plan") throw new Error("Queued message has no target plan.");
        if (!lastInput) throw new Error("The experiment plan did not resolve an agent for its queued follow-up.");
        const result = await runAgent({
          ...lastInput,
          prompt: `Follow-up after completing ${plan.path}:\n\n${item.text}`,
          logFileName: makeRunLogFileName(`${lastInput.agent}-${item.id}`)
        });
        messages.push({ text: item.text, planPath: plan.path, result });
        return result.exitCode === 0 ? "completed" : "failed";
      }
    });
    return { status: snapshot.status as RunQueueOutcome, plans, messages, queue: snapshot };
  } finally {
    unsubscribe?.();
  }
}
