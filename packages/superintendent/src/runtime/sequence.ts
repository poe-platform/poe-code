import path from "node:path";
import * as fsPromises from "node:fs/promises";
import {
  createRunQueue, makeRunLogFileName, resolveWorkflowPath, mapSourcePathIntoWorktree,
  type RunQueue, type RunQueueOutcome, type RunQueueSnapshot
} from "@poe-code/agent-harness-tools";
import { resolveSuperintendentDoc, type SuperintendentDoc } from "../document/parse.js";
import { withAutonomousAgentRunner } from "./agent-runner.js";
import { runBuilder } from "./run-builder.js";
import { runLoop, type AgentRunResult, type RunLoopOptions, type SuperintendentRunResult } from "./loop.js";

export interface SuperintendentSequenceOptions extends Omit<RunLoopOptions, "docPath"> {
  docs?: readonly string[];
  queue?: RunQueue;
  afterEachPlan?: readonly string[];
  sourceCwd?: string;
  onQueueChange?: (snapshot: RunQueueSnapshot) => void;
  onPlanResolved?: (document: SuperintendentDoc) => void;
  preparePlan?: (document: SuperintendentDoc) => Promise<Pick<RunLoopOptions, "builderAgent" | "logDir">>;
  runPlan?: (options: RunLoopOptions) => Promise<SuperintendentRunResult>;
}

export interface SuperintendentSequenceResult {
  status: RunQueueOutcome;
  plans: Array<SuperintendentRunResult & { docPath: string; builderAgent: string }>;
  messages: Array<{ text: string; planPath: string; result: AgentRunResult }>;
  queue: RunQueueSnapshot;
}

/** Drain a live sequence; follow-ups use the target plan's builder configuration. */
export async function runSuperintendentSequence(options: SuperintendentSequenceOptions): Promise<SuperintendentSequenceResult> {
  if (options.queue && (options.docs || options.afterEachPlan)) {
    throw new Error("Supply a queue or docs and afterEachPlan, not both.");
  }
  const runAgent = options.runAgent;
  if (!runAgent) throw new Error("runSuperintendentSequence requires a runAgent implementation.");
  const queue = options.queue ?? createRunQueue({
    plans: options.docs ?? [], afterEachPlan: options.afterEachPlan, cwd: options.cwd
  });
  const fs = options.fs ?? fsPromises;
  const plans: SuperintendentSequenceResult["plans"] = [];
  const messages: SuperintendentSequenceResult["messages"] = [];
  const unsubscribe = options.onQueueChange ? queue.onChange(options.onQueueChange) : undefined;
  options.onQueueChange?.(queue.getSnapshot());
  const {
    docs: ignoredDocs, queue: ignoredQueue, afterEachPlan: ignoredMessages,
    onQueueChange: ignoredQueueChange, sourceCwd, onPlanResolved, preparePlan, runPlan = runLoop, ...runOptions
  } = options;
  let activeDocument: SuperintendentDoc | undefined;
  let activeLogDir = options.logDir;
  try {
    const snapshot = await queue.run({
      signal: options.signal,
      shouldPause: options.callbacks?.shouldStop,
      async execute(item) {
        if (item.kind === "plan") {
          const resolvedPath = resolveWorkflowPath(item.path, options.cwd, options.homeDir);
          const docPath = sourceCwd ? mapSourcePathIntoWorktree(sourceCwd, resolvedPath, options.cwd) : resolvedPath;
          const { document } = await resolveSuperintendentDoc(docPath, await fs.readFile(docPath, "utf8"), fs);
          const prepared = await preparePlan?.(document);
          const builderAgent = prepared?.builderAgent ?? options.builderAgent ?? document.frontmatter.builder.agent;
          activeLogDir = prepared?.logDir ?? options.logDir;
          activeDocument = {
            ...document,
            frontmatter: { ...document.frontmatter, builder: { ...document.frontmatter.builder, agent: builderAgent } }
          };
          onPlanResolved?.(activeDocument);
          const result = await runPlan({ ...runOptions, docPath, builderAgent, logDir: activeLogDir });
          plans.push({ ...result, docPath, builderAgent });
          return result.stopReason === "completed" || result.stopReason === "dry_run" ? "completed"
            : result.stopReason === "aborted" ? "cancelled" : "paused";
        }
        if (!activeDocument) throw new Error("Queued message has no target plan.");
        const docPath = activeDocument.filePath;
        let result: AgentRunResult | undefined;
        await withAutonomousAgentRunner(async (agent, input) => {
          result = await runAgent({ ...input, agent, cwd: input.cwd ?? options.cwd });
          return result;
        }, () => runBuilder(activeDocument!, {}, {
          defaultCwd: options.cwd,
          promptOverride: `Follow-up after completing ${docPath}:\n\n${item.text}`,
          signal: options.signal,
          ...(activeLogDir ? { logPath: path.join(activeLogDir, makeRunLogFileName(`follow-up-${item.id}`)) } : {})
        }));
        if (!result) throw new Error("The builder did not return a result for its queued follow-up.");
        messages.push({ text: item.text, planPath: docPath, result });
        return result.exitCode === 0 ? "completed" : "failed";
      }
    });
    return { status: snapshot.status as RunQueueOutcome, plans, messages, queue: snapshot };
  } finally {
    unsubscribe?.();
  }
}
