import {
  createRunQueue,
  makeRunLogFileName,
  type RunQueue,
  type RunQueueOutcome,
  type RunQueueSnapshot
} from "@poe-code/agent-harness-tools";
import type { AgentRunInput, AgentRunResult, PipelineRunOptions, PipelineRunResult } from "../types.js";
import { runPipeline } from "./pipeline.js";

export interface PipelineSequenceOptions extends Omit<PipelineRunOptions, "plan"> {
  plans?: readonly string[];
  queue?: RunQueue;
  afterEachPlan?: readonly string[];
  onQueueChange?: (snapshot: RunQueueSnapshot) => void;
  /** Inject a plan runner when a host supplies initialization or other integrations. */
  runPlan?: (options: PipelineRunOptions) => Promise<PipelineRunResult>;
}

export interface PipelineSequenceResult {
  status: RunQueueOutcome;
  plans: PipelineRunResult[];
  messages: Array<{ text: string; planPath: string; result: AgentRunResult }>;
  queue: RunQueueSnapshot;
}

/** Keep appended plans and follow-ups in one execution context until the queue drains. */
export async function runPipelineSequence(options: PipelineSequenceOptions): Promise<PipelineSequenceResult> {
  if (options.queue && (options.plans || options.afterEachPlan)) {
    throw new Error("Supply a queue or plans and afterEachPlan, not both.");
  }
  if (!options.runAgent) throw new Error("runPipelineSequence requires a runAgent implementation.");
  const queue = options.queue ?? createRunQueue({
    plans: options.plans ?? [], afterEachPlan: options.afterEachPlan, cwd: options.cwd
  });
  const plans: PipelineRunResult[] = [];
  const messages: PipelineSequenceResult["messages"] = [];
  let context: Pick<AgentRunInput, "mcpServers" | "logDir"> = {};
  const unsubscribe = options.onQueueChange ? queue.onChange(options.onQueueChange) : undefined;
  options.onQueueChange?.(queue.getSnapshot());
  const {
    plans: ignoredPlans, queue: ignoredQueue, afterEachPlan: ignoredMessages,
    onQueueChange: ignoredQueueChange, runPlan: planRunner = runPipeline, ...runOptions
  } = options;
  try {
    const snapshot = await queue.run({
      signal: options.signal,
      async execute(item) {
        if (item.kind === "plan") {
          context = options.logDir ? { logDir: options.logDir } : {};
          const result = await planRunner({
            ...runOptions, plan: item.path,
            onPlanProgress(progress, planContext) {
              if (planContext) context = planContext;
              options.onPlanProgress?.(progress, planContext);
            }
          });
          plans.push(result);
          if (result.stopReason === "failed" || result.stopReason === "cancelled") return result.stopReason;
          if (result.stopReason === "max_runs") return "paused";
          return "completed";
        }
        const plan = queue.getSnapshot().items.find((entry) => entry.id === item.afterPlanId);
        if (!plan || plan.kind !== "plan") throw new Error("Queued message has no target plan.");
        const result = await options.runAgent!({
          agent: options.agent,
          prompt: `Follow-up after completing ${plans.at(-1)?.archivedPath ?? plan.path}:\n\n${item.text}`,
          cwd: options.cwd,
          ...(options.model ? { model: options.model } : {}),
          ...context,
          ...(context.logDir ? { logFileName: makeRunLogFileName(`follow-up-${item.id}`) } : {}),
          ...(options.signal ? { signal: options.signal } : {})
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
