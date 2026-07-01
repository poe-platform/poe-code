import path from "node:path";
import {
  getTheme,
  renderTable,
  runExplorer,
  spinner,
  type Action,
  type DetailItem,
  type ExplorerConfig,
  type Row
} from "toolcraft-design";
import type { AgentTraceFileSystem, AgentTraceSource, TraceReference } from "@poe-code/agent-traces";
import {
  listTraces,
  loadSubagentSummaries,
  loadTrace,
  loadTraceFromFile
} from "./loader.js";
import { renderTraceDetail, renderTraceLine } from "./render.js";
import type { SubagentSummary, TraceView } from "./types.js";

export interface RunTraceViewerOptions {
  cwd: string;
  homeDir: string;
  fs: AgentTraceFileSystem;
  assumeYes?: boolean;
  sources?: AgentTraceSource[];
  allWorkspaces?: boolean;
  since?: Date;
  limit?: number;
  json?: boolean;
  path?: string;
  output?: WritableOutput;
}

interface WritableOutput {
  write(chunk: string | Uint8Array): unknown;
}

interface TraceExplorerState {
  references: TraceReference[];
  rows: Row[];
  referenceByRowId: Map<string, TraceReference>;
  childrenByRowId: Map<string, TraceReference[]>;
}

const TRACE_TABLE_WIDTH = 80;

export async function runTraceViewer(options: RunTraceViewerOptions): Promise<void> {
  const output = options.output ?? process.stdout;

  if (options.path !== undefined) {
    const view = await loadTraceFromFile(options.path, { fs: options.fs });
    const subagents = await loadSubagentSummariesIfPresent(view, options.fs);
    if (options.json) {
      writeLine(output, JSON.stringify({ ...view, subagents }, null, 2));
      return;
    }

    writeLine(output, renderTraceDetail(view, subagents));
    return;
  }

  const discover = () => listTraces({
    cwd: options.cwd,
    homeDir: options.homeDir,
    fs: options.fs,
    sources: options.sources,
    allWorkspaces: options.allWorkspaces,
    since: options.since,
    limit: options.limit
  });
  const references = await discover();

  if (references.length === 0) {
    writeLine(output, "No traces found");
    return;
  }

  if (options.json || options.assumeYes || process.stdin.isTTY !== true) {
    if (options.json) {
      writeLine(output, JSON.stringify(references, null, 2));
      return;
    }

    writeLine(output, renderTraceReferenceTable(references));
    return;
  }

  await runExplorer(buildTraceExplorerConfig({
    title: "Agent traces",
    references,
    fs: options.fs,
    output,
    onRefresh: discover
  }));
}

function renderTraceReferenceTable(references: TraceReference[]): string {
  const theme = getTheme();
  return renderTable({
    theme,
    columns: [
      { name: "source", title: "Source", alignment: "left", maxLen: 8 },
      { name: "title", title: "Title", alignment: "left", maxLen: 30 },
      { name: "updated", title: "Updated", alignment: "left", maxLen: 18 },
      { name: "cwd", title: "Cwd", alignment: "left", maxLen: 11 }
    ],
    rows: references.map((reference) => ({
      source: sourceCell(reference.source, theme),
      title: compactWhitespace(reference.title) || reference.id,
      updated: reference.updatedAt?.toISOString() ?? "",
      cwd: reference.cwd === undefined ? "" : path.basename(reference.cwd)
    })),
    maxWidth: TRACE_TABLE_WIDTH
  });
}

function sourceCell(source: AgentTraceSource, theme: ReturnType<typeof getTheme>): string {
  const colors = {
    claude: theme.accent,
    codex: theme.info,
    "poe-code": theme.success
  } satisfies Record<AgentTraceSource, (text: string) => string>;

  return colors[source](source);
}

function compactWhitespace(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }

  const parts: string[] = [];
  let previousWasWhitespace = false;
  for (const character of value.trim()) {
    if (character.trim().length === 0) {
      if (!previousWasWhitespace) {
        parts.push(" ");
      }
      previousWasWhitespace = true;
      continue;
    }

    parts.push(character);
    previousWasWhitespace = false;
  }
  return parts.join("");
}

function buildTraceExplorerConfig(options: {
  title: string;
  references: TraceReference[];
  fs: AgentTraceFileSystem;
  output: WritableOutput;
  onRefresh: () => Promise<TraceReference[]>;
}): ExplorerConfig<void> {
  const state = createExplorerState(options.references);

  async function refresh(): Promise<void> {
    const references = await options.onRefresh();
    const next = createExplorerState(references);
    state.references = next.references;
    state.rows = next.rows;
    state.referenceByRowId = next.referenceByRowId;
    state.childrenByRowId = next.childrenByRowId;
  }

  const actions: Action<void>[] = [
    {
      id: "open",
      label: "Open detail",
      primary: true,
      showInFooter: true,
      handler: (ctx) => {
        const reference = getReference(state.referenceByRowId, ctx.row.id);
        ctx.exit(async () => {
          const loaded = await withDelayedSpinner(`Loading ${ctx.row.title}`, async () => {
            const view = await loadTrace(reference, { fs: options.fs });
            const subagents = await loadSubagentSummariesIfPresent(view, options.fs);
            return { view, subagents };
          });

          writeLine(options.output, renderTraceDetail(loaded.view, loaded.subagents));
        });
      }
    },
    {
      id: "subagents",
      key: "s",
      label: "Subagents",
      predicate: (ctx) => (state.childrenByRowId.get(ctx.row.id)?.length ?? 0) > 0,
      handler: (ctx) => {
        const children = state.childrenByRowId.get(ctx.row.id) ?? [];
        if (children.length === 0) {
          ctx.toast("No subagents", "muted");
          return;
        }

        ctx.exit(async () => {
          await runExplorer(buildTraceExplorerConfig({
            title: `${ctx.row.title} subagents`,
            references: children,
            fs: options.fs,
            output: options.output,
            onRefresh: async () => children
          }));
        });
      }
    },
    {
      id: "copy-path",
      key: "c",
      label: "Print path",
      handler: (ctx) => {
        const reference = getReference(state.referenceByRowId, ctx.row.id);
        if (reference.path === undefined) {
          ctx.toast("Trace has no file path", "warning");
          return;
        }
        void ctx.suspendAnd(async () => {
          writeLine(options.output, reference.path ?? "");
        });
      }
    },
    {
      id: "refresh",
      key: "r",
      label: "Refresh",
      handler: async (ctx) => {
        await ctx.refresh();
      }
    }
  ];

  return {
    title: options.title,
    rows: async () => state.rows,
    refresh,
    detail: {
      items: async (row, ctx) => {
        const reference = getReference(state.referenceByRowId, row.id);
        const loaded = await loadUnlessAborted(ctx.signal, () =>
          withDelayedSpinner(`Loading ${row.title}`, async () => {
            const view = await loadTrace(reference, { fs: options.fs });
            const subagents = await loadSubagentSummariesIfPresent(view, options.fs);
            return { view, subagents };
          })
        );

        if (loaded === undefined || ctx.signal.aborted) {
          return [];
        }

        state.childrenByRowId.set(row.id, loaded.view.children ?? []);
        return [
          {
            id: row.id,
            render: () => renderTraceDetail(loaded.view, loaded.subagents)
          } satisfies DetailItem
        ];
      }
    },
    actions,
    multiSelect: false,
    emptyHint: "No traces found"
  };
}

function createExplorerState(references: TraceReference[]): TraceExplorerState {
  const rows = toRows(references);
  return {
    references,
    rows,
    referenceByRowId: new Map(rows.map((row, index) => [row.id, references[index]!])),
    childrenByRowId: new Map()
  };
}

function toRows(references: TraceReference[]): Row[] {
  const counts = new Map<string, number>();
  for (const reference of references) {
    const baseId = rowBaseId(reference);
    counts.set(baseId, (counts.get(baseId) ?? 0) + 1);
  }

  return references.map((reference, index) => {
    const baseId = rowBaseId(reference);
    const rendered = renderTraceLine(reference);
    return {
      id: counts.get(baseId) === 1 ? baseId : `${baseId}\u0000${index}`,
      title: rendered.label,
      subtitle: rendered.meta,
      badge: { text: reference.source }
    };
  });
}

function rowBaseId(reference: TraceReference): string {
  return `${reference.source}:${reference.id}`;
}

function getReference(
  referenceByRowId: ReadonlyMap<string, TraceReference>,
  rowId: string
): TraceReference {
  const reference = referenceByRowId.get(rowId);
  if (reference === undefined) {
    throw new Error(`Trace row is no longer available: ${rowId}`);
  }
  return reference;
}

async function loadSubagentSummariesIfPresent(
  view: TraceView,
  fs: AgentTraceFileSystem
): Promise<SubagentSummary[]> {
  return view.children === undefined || view.children.length === 0
    ? []
    : loadSubagentSummaries(view, { fs });
}

async function loadUnlessAborted<T>(
  signal: AbortSignal,
  load: () => Promise<T>
): Promise<T | undefined> {
  if (signal.aborted) {
    return undefined;
  }

  return new Promise<T | undefined>((resolve, reject) => {
    const abort = () => {
      resolve(undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    load()
      .then((value) => {
        resolve(signal.aborted ? undefined : value);
      }, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      });
  });
}

async function withDelayedSpinner<T>(message: string, load: () => Promise<T>): Promise<T> {
  const s = spinner();
  let started = false;
  const timer = setTimeout(() => {
    started = true;
    s.start(message);
  }, 700);

  try {
    return await load();
  } finally {
    clearTimeout(timer);
    if (started) {
      s.stop("Loaded trace");
    }
  }
}

function writeLine(output: WritableOutput, value: string): void {
  output.write(`${value}\n`);
}
