import {
  traceReaders,
  type AgentTraceSource,
  type NormalizedTrace,
  type TraceReference
} from "@poe-code/agent-traces";
import { computeContextBreakdown } from "./breakdown.js";
import { computeContextUsage } from "./context.js";
import {
  defaultTraceTokenCacheDir,
  readCachedBreakdown,
  traceFileIdentity,
  writeCachedBreakdown
} from "./token-cache.js";
import type {
  ContextBreakdown,
  ListTracesOptions,
  LoadTraceOptions,
  LoadTraceTreeOptions,
  SubagentSummary,
  TraceTreeNode,
  TraceView
} from "./types.js";

const DEFAULT_TREE_MAX_DEPTH = 8;
const DEFAULT_TREE_MAX_NODES = 50;

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

  const filePath = reference.path;
  const identity =
    filePath === undefined ? undefined : await traceFileIdentity(options.fs, filePath);
  const trace = await reader.read(reference, { fs: options.fs });
  const breakdown = await loadBreakdown(trace, filePath, identity, options);
  return {
    ...trace,
    context: computeContextUsage(trace, breakdown.measuredTokens),
    breakdown
  };
}

const exactBreakdownsInFlight = new Map<string, Promise<void>>();
const EXACT_BREAKDOWN_START_DELAY_MS = 1_000;

async function loadBreakdown(
  trace: NormalizedTrace,
  filePath: string | undefined,
  identity: Awaited<ReturnType<typeof traceFileIdentity>>,
  options: LoadTraceOptions
): Promise<ContextBreakdown> {
  const cacheDir = options.cacheDir ?? defaultTraceTokenCacheDir();
  if (filePath !== undefined && identity !== undefined) {
    const cached = await readCachedBreakdown(options.fs, cacheDir, filePath, identity);
    if (cached !== undefined) {
      return cached;
    }
  }

  if (options.deferExactTokens === true) {
    const estimated = await computeContextBreakdown(trace, { mode: "estimated" });
    if (filePath !== undefined && identity !== undefined && options.signal?.aborted !== true) {
      scheduleExactBreakdown(trace, filePath, identity, cacheDir, options);
    }
    return estimated;
  }

  const breakdown = await computeContextBreakdown(trace, { signal: options.signal });
  if (filePath !== undefined && identity !== undefined && options.signal?.aborted !== true) {
    await writeCachedBreakdown(options.fs, cacheDir, filePath, identity, breakdown);
  }
  return breakdown;
}

function scheduleExactBreakdown(
  trace: NormalizedTrace,
  filePath: string,
  identity: NonNullable<Awaited<ReturnType<typeof traceFileIdentity>>>,
  cacheDir: string,
  options: LoadTraceOptions
): void {
  if (exactBreakdownsInFlight.has(filePath)) {
    return;
  }

  const task = (async () => {
    await new Promise((resolve) => setTimeout(resolve, EXACT_BREAKDOWN_START_DELAY_MS));
    const breakdown = await computeContextBreakdown(trace);
    await writeCachedBreakdown(options.fs, cacheDir, filePath, identity, breakdown);
    options.onExactBreakdown?.(breakdown);
  })()
    .catch(() => {
      // Exact counting is best-effort in the background; the estimate stays visible.
    })
    .finally(() => {
      exactBreakdownsInFlight.delete(filePath);
    });
  exactBreakdownsInFlight.set(filePath, task);
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

export async function loadTraceTree(
  root: TraceView,
  options: LoadTraceTreeOptions
): Promise<TraceTreeNode> {
  const maxDepth = options.maxDepth ?? DEFAULT_TREE_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_TREE_MAX_NODES;
  const seen = new Set<string>([treeNodeKey(root)]);
  let remainingNodes = Math.max(0, maxNodes - 1);

  return {
    view: root,
    children: await loadChildTreeNodes(root.children ?? [], options, {
      depth: 1,
      maxDepth,
      seen,
      takeNode: () => {
        if (remainingNodes <= 0) {
          return false;
        }
        remainingNodes -= 1;
        return true;
      }
    })
  };
}

async function loadChildTreeNodes(
  references: TraceReference[],
  options: LoadTraceTreeOptions,
  state: {
    depth: number;
    maxDepth: number;
    seen: Set<string>;
    takeNode: () => boolean;
  }
): Promise<TraceTreeNode[]> {
  if (references.length === 0 || state.depth > state.maxDepth) {
    return [];
  }

  const children: TraceTreeNode[] = [];
  for (const reference of references) {
    if (!state.takeNode()) {
      break;
    }

    const key = treeReferenceKey(reference);
    if (state.seen.has(key)) {
      children.push({
        view: emptyTreeView(reference),
        children: [],
        reference,
        unavailable: {
          reference,
          reason: "already included"
        }
      });
      continue;
    }
    state.seen.add(key);

    try {
      const view = await loadTrace(reference, options);
      children.push({
        view,
        reference,
        children: await loadChildTreeNodes(view.children ?? [], options, {
          depth: state.depth + 1,
          maxDepth: state.maxDepth,
          seen: state.seen,
          takeNode: state.takeNode
        })
      });
    } catch (error) {
      children.push({
        view: emptyTreeView(reference),
        children: [],
        reference,
        unavailable: {
          reference,
          reason: error instanceof Error ? error.message : "failed to load"
        }
      });
    }
  }

  return children;
}

function emptyTreeView(reference: TraceReference): TraceView {
  return {
    source: reference.source,
    id: reference.id,
    path: reference.path,
    cwd: reference.cwd,
    title: reference.title,
    turns: [],
    context: { tokens: 0, window: 0, percent: 0, source: "estimated" },
    breakdown: { measuredTokens: 0, categories: [], source: "exact" }
  };
}

function treeNodeKey(view: Pick<TraceView, "source" | "id" | "path">): string {
  return treeReferenceKey({
    source: view.source,
    id: view.id,
    path: view.path
  });
}

function treeReferenceKey(reference: Pick<TraceReference, "source" | "id" | "path">): string {
  return reference.path === undefined
    ? `${reference.source}:${reference.id}`
    : `${reference.source}:${reference.id}:${reference.path}`;
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

  if (
    value.type === "session" &&
    typeof value.id === "string" &&
    (typeof value.version === "number" || typeof value.cwd === "string")
  ) {
    return "pi";
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
