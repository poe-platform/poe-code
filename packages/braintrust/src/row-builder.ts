import type { JournalEntry } from "@poe-code/experiment-loop";
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";

import type { BraintrustClient } from "./client.js";
import { redact } from "./redact.js";

type SuperintendentRole = "builder" | "inspector" | "superintendent" | "owner";
type EventRecord = Record<string, unknown>;

interface BraintrustSpan {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpan;
  log(event: BraintrustLogEvent): void;
  end(): void;
}

interface BraintrustSpanParent {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpan;
}

interface BraintrustLogEvent {
  input?: unknown;
  output?: unknown;
  scores?: Record<string, number>;
  metrics?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

type PipelineRowState = {
  span?: Promise<BraintrustSpan | undefined>;
  progress?: TaskProgress;
};

type ExperimentIteration = {
  span?: BraintrustSpan;
  agent: string;
  iteration: number;
  baseline?: Record<string, number>;
  metrics: Record<string, number>;
  commit?: string;
  reset?: string;
};

export function makePipelineRowState(client: BraintrustClient): {
  start(progress: TaskProgress): void;
  complete(progress: TaskCompletion): void;
} {
  const rows = new Map<string, PipelineRowState>();

  return {
    start(progress: TaskProgress): void {
      try {
        const key = pipelineKey(progress);
        const row: PipelineRowState = {
          progress,
          span: openCurrentChildSpan(client, {
            name: `step:${readPipelineStep(progress)}:${readPipelineIndex(progress)}`,
            type: "task",
          }, "pipeline step start"),
        };
        rows.set(key, row);
      } catch (err) {
        client.recordError(err, "pipeline step start");
      }
    },

    complete(progress: TaskCompletion): void {
      try {
        const key = pipelineKey(progress);
        const row = rows.get(key);
        rows.delete(key);

        void (async () => {
          try {
            const span = row?.span === undefined
              ? await openCurrentChildSpan(client, {
                name: `step:${readPipelineStep(progress)}:${readPipelineIndex(progress)}`,
                type: "task",
              }, "pipeline step complete")
              : await row.span;

            if (span === undefined) {
              return;
            }

            try {
              span.log(buildPipelineCompletionLog(row?.progress ?? progress, progress));
            } finally {
              span.end();
            }
          } catch (err) {
            client.recordError(err, "pipeline step complete");
          }
        })();
      } catch (err) {
        client.recordError(err, "pipeline step complete");
      }
    },
  };
}

export async function logSuperintendentRole(
  client: BraintrustClient,
  role: SuperintendentRole,
  result: unknown,
): Promise<void> {
  try {
    const span = await openCurrentChildSpan(client, {
      name: `role:${role}`,
      type: "task",
    }, `superintendent ${role}`);

    if (span === undefined) {
      return;
    }

    try {
      span.log(buildSuperintendentLog(role, result));
    } finally {
      span.end();
    }
  } catch (err) {
    client.recordError(err, `superintendent ${role}`);
  }
}

export function makeExperimentIterationState(
  client: BraintrustClient,
  experimentName: string,
): {
  start(index: number, agent: string): Promise<void>;
  baseline(b: Record<string, number>): void;
  metric(name: string, value: number): void;
  commit(hash: string): void;
  reset(hash: string): void;
  complete(index: number, entry: JournalEntry): Promise<void>;
} {
  const rows = new Map<number, ExperimentIteration>();
  let latestBaseline: Record<string, number> | undefined;

  return {
    async start(index: number, agent: string): Promise<void> {
      try {
        const experiment = asSpanParent(await client.getExperiment(experimentName));
        rows.set(index, {
          span: experiment.startSpan({
            name: `iteration:${index}`,
            type: "task",
          }),
          agent,
          iteration: index,
          baseline: latestBaseline,
          metrics: {},
        });
      } catch (err) {
        client.recordError(err, `experiment ${experimentName} iteration start`);
      }
    },

    baseline(b: Record<string, number>): void {
      try {
        latestBaseline = { ...b };
        for (const row of rows.values()) {
          row.baseline = latestBaseline;
        }
      } catch (err) {
        client.recordError(err, `experiment ${experimentName} baseline`);
      }
    },

    metric(name: string, value: number): void {
      try {
        const row = readLatestRow(rows);
        if (row !== undefined && Number.isFinite(value)) {
          row.metrics[name] = value;
        }
      } catch (err) {
        client.recordError(err, `experiment ${experimentName} metric`);
      }
    },

    commit(hash: string): void {
      try {
        const row = readLatestRow(rows);
        if (row !== undefined) {
          row.commit = hash;
        }
      } catch (err) {
        client.recordError(err, `experiment ${experimentName} commit`);
      }
    },

    reset(hash: string): void {
      try {
        const row = readLatestRow(rows);
        if (row !== undefined) {
          row.reset = hash;
        }
      } catch (err) {
        client.recordError(err, `experiment ${experimentName} reset`);
      }
    },

    async complete(index: number, entry: JournalEntry): Promise<void> {
      const row = rows.get(index);
      rows.delete(index);

      try {
        if (row?.span === undefined) {
          return;
        }

        try {
          row.span.log(buildExperimentLog(row, entry));
        } finally {
          row.span.end();
        }
      } catch (err) {
        client.recordError(err, `experiment ${experimentName} iteration complete`);
      }
    },
  };
}

async function openCurrentChildSpan(
  client: BraintrustClient,
  args: { name: string; type: "task" | "tool" },
  ctx: string,
): Promise<BraintrustSpan | undefined> {
  try {
    const { currentSpan } = await import("braintrust");
    return asSpanParent(currentSpan()).startSpan(args);
  } catch (err) {
    client.recordError(err, ctx);
    return undefined;
  }
}

function buildPipelineCompletionLog(
  started: TaskProgress,
  completed: TaskCompletion,
): BraintrustLogEvent {
  const startRecord = asRecord(started) ?? {};
  const completeRecord = asRecord(completed) ?? {};

  return {
    input: redact({
      step_name: readPipelineStep(started),
      step_prompt: readFirstString(startRecord, ["step_prompt", "stepPrompt", "prompt"]),
      plan_section: readFirstString(startRecord, ["plan_section", "planSection", "section"]),
    }),
    output: redact({
      result_summary: readFirstString(completeRecord, [
        "result_summary",
        "resultSummary",
        "summary",
      ]),
      files_changed: readFirstValue(completeRecord, ["files_changed", "filesChanged"]),
      success: completed.success,
    }),
    scores: {
      passed: completed.success ? 1 : 0,
    },
    metrics: buildPipelineMetrics(completed),
  };
}

function buildSuperintendentLog(
  role: SuperintendentRole,
  result: unknown,
): BraintrustLogEvent {
  const record = asRecord(result);
  const event: BraintrustLogEvent = {
    input: redact(record?.input),
    output: redact(record?.output ?? result),
  };

  if (role === "inspector") {
    const satisfied = readSatisfiedScore(record);
    if (satisfied !== undefined) {
      event.scores = { satisfied };
    }
  }

  return event;
}

function buildExperimentLog(
  row: ExperimentIteration,
  entry: JournalEntry,
): BraintrustLogEvent {
  const entryRecord = asRecord(entry) ?? {};
  const scores = buildExperimentScores(row.baseline, entry.scores);
  const metrics = { ...row.metrics };

  if (Number.isFinite(entry.durationMs)) {
    metrics.durationMs = entry.durationMs;
  }

  return {
    input: redact({
      brief: readFirstString(entryRecord, ["brief"]),
      baseline: row.baseline,
      agent: row.agent,
      iteration: row.iteration,
    }),
    output: redact({
      diff_summary: entry.agentOutput,
      kept: entry.status === "keep",
    }),
    ...(Object.keys(scores).length === 0 ? {} : { scores }),
    ...(Object.keys(metrics).length === 0 ? {} : { metrics }),
    metadata: {
      ...(row.commit !== undefined ? { commit: row.commit } : {}),
      ...(row.reset !== undefined ? { reset: row.reset } : {}),
    },
  };
}

function buildPipelineMetrics(progress: TaskCompletion): Record<string, number> {
  const metrics: Record<string, number> = {};
  const usage = progress.usage;

  if (usage !== undefined) {
    addMetric(metrics, "prompt_tokens", usage.inputTokens);
    addMetric(metrics, "completion_tokens", usage.outputTokens);
    addMetric(metrics, "tokens", usage.inputTokens + usage.outputTokens);
    addMetric(metrics, "prompt_cached_tokens", usage.cachedTokens);
  }

  addMetric(metrics, "durationMs", progress.durationMs);

  return metrics;
}

function buildExperimentScores(
  baseline: Record<string, number> | undefined,
  scores: Record<string, number> | undefined,
): Record<string, number> {
  const result = { ...(scores ?? {}) };
  const delta = sumDelta(baseline, scores);

  if (delta !== undefined) {
    result.delta = delta;
  }

  return result;
}

function sumDelta(
  baseline: Record<string, number> | undefined,
  scores: Record<string, number> | undefined,
): number | undefined {
  if (baseline === undefined || scores === undefined) {
    return undefined;
  }

  let delta = 0;
  let count = 0;

  for (const [name, value] of Object.entries(scores)) {
    const base = baseline[name];
    if (Number.isFinite(value) && Number.isFinite(base)) {
      delta += value - base;
      count += 1;
    }
  }

  return count === 0 ? undefined : delta;
}

function readSatisfiedScore(record: EventRecord | undefined): number | undefined {
  const verdict = record?.verdict ?? record?.satisfied;

  if (typeof verdict === "boolean") {
    return verdict ? 1 : 0;
  }

  if (typeof verdict === "number" && Number.isFinite(verdict)) {
    return verdict > 0 ? 1 : 0;
  }

  if (typeof verdict !== "string") {
    return undefined;
  }

  const normalized = verdict.trim().toLowerCase();
  if (["satisfied", "satisfy", "pass", "passed", "approve", "approved", "true", "yes"].includes(normalized)) {
    return 1;
  }

  if (["unsatisfied", "fail", "failed", "reject", "rejected", "false", "no"].includes(normalized)) {
    return 0;
  }

  return undefined;
}

function pipelineKey(progress: TaskProgress): string {
  return [
    progress.taskId,
    progress.stepName ?? "",
    progress.phase ?? "",
    String(progress.taskIndex),
    String(progress.stepIndex ?? ""),
  ].join(":");
}

function readPipelineStep(progress: TaskProgress): string {
  return progress.stepName ?? progress.phase ?? progress.taskTitle;
}

function readPipelineIndex(progress: TaskProgress): number {
  return progress.stepIndex ?? progress.taskIndex;
}

function readLatestRow(
  rows: Map<number, ExperimentIteration>,
): ExperimentIteration | undefined {
  let latest: ExperimentIteration | undefined;

  for (const row of rows.values()) {
    if (latest === undefined || row.iteration > latest.iteration) {
      latest = row;
    }
  }

  return latest;
}

function asSpanParent(value: unknown): BraintrustSpanParent {
  const span = value as Partial<BraintrustSpanParent> | undefined;
  if (span === undefined || typeof span.startSpan !== "function") {
    throw new Error("Braintrust span parent unavailable");
  }

  return span as BraintrustSpanParent;
}

function asRecord(value: unknown): EventRecord | undefined {
  return typeof value === "object" && value !== null
    ? value as EventRecord
    : undefined;
}

function readFirstString(
  record: EventRecord,
  keys: string[],
): string | undefined {
  const value = readFirstValue(record, keys);
  return typeof value === "string" ? value : undefined;
}

function readFirstValue(
  record: EventRecord,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function addMetric(
  metrics: Record<string, number>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) {
    metrics[key] = value;
  }
}
