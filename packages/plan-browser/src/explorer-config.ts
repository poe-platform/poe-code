import path from "node:path";
import type {
  Action,
  DetailItem,
  ExplorerConfig,
  Row
} from "@poe-code/design-system";
import { archivePlan, deletePlan, editFile } from "./actions.js";
import { loadPlanPreviewMarkdown } from "./format.js";
import type { ActionFs, DiscoveryFs, PlanEntry } from "./types.js";

export interface BuildPlanExplorerConfigOptions {
  plans: PlanEntry[];
  fs: ActionFs & DiscoveryFs;
  variables: Record<string, string | undefined>;
  onRefresh: () => Promise<PlanEntry[]>;
  onCreatePlan?: () => Promise<void>;
  loadDetailMarkdown?: (entry: PlanEntry, fs: ActionFs & DiscoveryFs) => Promise<string>;
}

export function buildPlanExplorerConfig(
  options: BuildPlanExplorerConfigOptions
): ExplorerConfig<void> {
  const loadDetailMarkdown = options.loadDetailMarkdown ?? loadPlanPreviewMarkdown;
  let plans = options.plans;
  let rows = toRows(plans);
  let entryByRowId = toEntryMap(plans);

  async function refresh(): Promise<void> {
    plans = await options.onRefresh();
    rows = toRows(plans);
    entryByRowId = toEntryMap(plans);
  }

  const actions: Action<void>[] = [
    {
      id: "edit",
      key: "e",
      label: "Edit in $EDITOR",
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        await ctx.suspendAnd(async () => {
          editFile(entry.absolutePath, { env: options.variables });
        });
        await ctx.refresh();
        ctx.toast(`Edited ${path.basename(entry.path)}`, "info");
      }
    },
    {
      id: "archive",
      key: "a",
      label: "Archive",
      destructive: true,
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        await archivePlan(entry, options.fs as ActionFs);
        await ctx.refresh();
        ctx.toast(`Archived ${path.basename(entry.path)}`, "warning");
      }
    },
    {
      id: "delete",
      key: "d",
      label: "Delete",
      destructive: true,
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        await deletePlan(entry, options.fs as ActionFs);
        await ctx.refresh();
        ctx.toast(`Deleted ${path.basename(entry.path)}`, "error");
      }
    }
  ];

  if (options.onCreatePlan !== undefined) {
    actions.push({
      id: "new",
      key: "n",
      primary: true,
      label: "New plan",
      predicate: () => options.onCreatePlan != null,
      handler: async (ctx) => {
        await ctx.suspendAnd(() => options.onCreatePlan!());
        await ctx.refresh();
      }
    });
  }

  return {
    title: "Plans",
    rows: async () => rows,
    refresh,
    detail: {
      items: async (row, ctx) => {
        const entry = getEntry(entryByRowId, row.id);
        const markdown = await loadMarkdownUnlessAborted(ctx.signal, () =>
          loadDetailMarkdown(entry, options.fs)
        );

        if (markdown === undefined || ctx.signal.aborted) {
          return [];
        }

        return [
          {
            id: entry.absolutePath,
            render: () => markdown
          } satisfies DetailItem
        ];
      }
    },
    actions,
    multiSelect: false,
    emptyHint: "No plans found"
  };
}

function toRows(plans: PlanEntry[]): Row[] {
  const rowIds = createRowIds(plans);
  return plans.map((entry, index) => ({
    id: rowIds[index]!,
    title: path.basename(entry.path),
    subtitle: entry.detail,
    badge: { text: entry.typeLabel },
    group: entry.kind
  }));
}

function toEntryMap(plans: PlanEntry[]): Map<string, PlanEntry> {
  const rowIds = createRowIds(plans);
  return new Map(plans.map((entry, index) => [rowIds[index]!, entry]));
}

function createRowIds(plans: PlanEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of plans) {
    counts.set(entry.absolutePath, (counts.get(entry.absolutePath) ?? 0) + 1);
  }

  return plans.map((entry, index) =>
    counts.get(entry.absolutePath) === 1 ? entry.absolutePath : `${entry.absolutePath}\u0000${index}`
  );
}

function getEntry(entryByRowId: Map<string, PlanEntry>, rowId: string): PlanEntry {
  const entry = entryByRowId.get(rowId);
  if (entry === undefined) {
    throw new Error(`Plan row is no longer available: ${rowId}`);
  }
  return entry;
}

async function loadMarkdownUnlessAborted(
  signal: AbortSignal,
  load: () => Promise<string>
): Promise<string | undefined> {
  if (signal.aborted) {
    return undefined;
  }

  return new Promise<string | undefined>((resolve, reject) => {
    const abort = () => {
      resolve(undefined);
    };

    signal.addEventListener("abort", abort, { once: true });
    load()
      .then((markdown) => {
        resolve(signal.aborted ? undefined : markdown);
      }, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      });
  });
}
