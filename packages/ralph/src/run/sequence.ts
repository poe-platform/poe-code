import {
  createRunQueue,
  makeRunLogFileName,
  type RunQueue,
  type RunQueueOutcome,
  type RunQueueSnapshot
} from "@poe-code/agent-harness-tools";
import type { AgentRunInput, AgentRunResult, RalphRunOptions, RalphRunResult } from "../types.js";
import { runRalph } from "./ralph.js";

export interface RalphSequenceOptions extends Omit<RalphRunOptions, "docPath"> {
  docs?: readonly string[];
  queue?: RunQueue;
  afterEachPlan?: readonly string[];
  onQueueChange?: (snapshot: RunQueueSnapshot) => void;
  /** A host may resolve per-plan overrides before invoking the normal runner. */
  runPlan?: (options: RalphRunOptions) => Promise<RalphRunResult>;
}

export interface RalphSequenceResult {
  status: RunQueueOutcome;
  plans: RalphRunResult[];
  messages: Array<{ text: string; planPath: string; result: AgentRunResult }>;
  queue: RunQueueSnapshot;
}

export async function runRalphSequence(options: RalphSequenceOptions): Promise<RalphSequenceResult> {
  if (options.queue && (options.docs || options.afterEachPlan)) {
    throw new Error("Supply a queue or docs and afterEachPlan, not both.");
  }
  const runAgent = options.runAgent;
  if (!runAgent) throw new Error("runRalphSequence requires a runAgent implementation.");
  const queue = options.queue ?? createRunQueue({
    plans: options.docs ?? [], afterEachPlan: options.afterEachPlan, cwd: options.cwd
  });
  const plans: RalphRunResult[] = [];
  const messages: RalphSequenceResult["messages"] = [];
  const unsubscribe = options.onQueueChange ? queue.onChange(options.onQueueChange) : undefined;
  options.onQueueChange?.(queue.getSnapshot());
  const {
    docs: ignoredDocs, queue: ignoredQueue, afterEachPlan: ignoredMessages,
    onQueueChange: ignoredChange, runPlan = runRalph, ...runOptions
  } = options;
  let lastInput: AgentRunInput | undefined;
  try {
    const snapshot = await queue.run({
      signal: options.signal,
      async execute(item) {
        if (item.kind === "plan") {
          lastInput = undefined;
          const result = await runPlan({
            ...runOptions, docPath: item.path,
            async runAgent(input) {
              lastInput = input;
              return await runAgent(input);
            }
          });
          plans.push(result);
          return result.stopReason === "failed" || result.stopReason === "cancelled"
            ? result.stopReason : "completed";
        }
        const plan = queue.getSnapshot().items.find((entry) => entry.id === item.afterPlanId);
        if (!plan || plan.kind !== "plan") throw new Error("Queued message has no target plan.");
        if (!lastInput) throw new Error("The plan did not run an agent for its queued follow-up.");
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
