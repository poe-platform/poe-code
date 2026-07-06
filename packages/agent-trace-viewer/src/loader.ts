import { traceReaders, type AgentTraceSource, type TraceReference } from "@poe-code/agent-traces";
import { computeContextBreakdown } from "./breakdown.js";
import { computeContextUsage } from "./context.js";
import type { ListTracesOptions, LoadTraceOptions, SubagentSummary, TraceView } from "./types.js";

export async function listTraces(options: ListTracesOptions): Promise<TraceReference[]> {
  const readers =
    options.sources === undefined
      ? traceReaders
      : traceReaders.filter((reader) => options.sources?.includes(reader.id) ?? false);
  const discovered: TraceReference[] = [];

  for (const reader of readers) {
    try {
      discovered.push(
        ...(await reader.discover({
          cwd: options.cwd,
          homeDir: options.homeDir,
          fs: options.fs,
          allWorkspaces: options.allWorkspaces,
          since: options.since,
          sqlite: options.sqlite
        }))
      );
    } catch {
      // Trace backends are optional; missing local stores should not hide other sources.
    }
  }

  const sorted = discovered.sort(
    (left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt)
  );
  return sorted.slice(0, options.limit ?? 50);
}

export async function loadTrace(
  reference: TraceReference,
  options: LoadTraceOptions
): Promise<TraceView> {
  const reader = traceReaders.find((candidate) => candidate.id === reference.source);
  if (reader === undefined) {
    throw new Error(`No trace reader registered for source: ${reference.source}`);
  }

  const trace = await reader.read(reference, { fs: options.fs });
  return {
    ...trace,
    context: computeContextUsage(trace),
    breakdown: computeContextBreakdown(trace)
  };
}

export async function loadSubagentSummaries(
  view: TraceView,
  options: LoadTraceOptions
): Promise<SubagentSummary[]> {
  if (view.children === undefined || view.children.length === 0) {
    return [];
  }

  const summaries: SubagentSummary[] = [];
  for (const reference of view.children) {
    try {
      const child = await loadTrace(reference, options);
      summaries.push({
        reference,
        context: child.context,
        turnCount: child.turns.length
      });
    } catch {
      // Subagent references can outlive local files; keep the parent trace usable.
    }
  }

  return summaries;
}

export function detectTraceFile(firstLine: string): AgentTraceSource | undefined {
  let value: unknown;
  try {
    value = JSON.parse(firstLine);
  } catch {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (Object.hasOwn(value, "event")) {
    return "poe-code";
  }

  if (
    value.type === "session_meta" ||
    value.type === "response_item" ||
    value.type === "event_msg"
  ) {
    return "codex";
  }

  if (
    Object.hasOwn(value, "sessionId") ||
    value.type === "user" ||
    value.type === "assistant" ||
    value.type === "system"
  ) {
    return "claude";
  }

  return undefined;
}

export async function loadTraceFromFile(
  path: string,
  options: LoadTraceOptions
): Promise<TraceView> {
  const contents = await options.fs.readFile(path, "utf8");
  const firstLineEnd = contents.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? contents : contents.slice(0, firstLineEnd);
  const source = detectTraceFile(firstLine);

  if (source === undefined) {
    throw new Error(`Unable to detect trace source for file: ${path}`);
  }

  return loadTrace({ source, id: path, path }, options);
}

function dateValue(date: Date | undefined): number {
  return date?.getTime() ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
