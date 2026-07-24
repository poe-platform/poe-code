import path from "node:path";
import type {
  Action,
  ExplorerConfig,
  Row
} from "toolcraft-design";
import { isCancel, normalizeExplorerConfig, promptText } from "toolcraft-design";
import {
  archivePlan,
  deletePlan,
  editFile,
  restorePlanFromLater,
  savePlanForLater
} from "./actions.js";
import { loadPlanPreviewMarkdown } from "./format.js";
import type { ActionFs, DiscoveryFs, PlanEntry } from "./types.js";

export interface BuildPlanExplorerConfigOptions {
  plans: PlanEntry[];
  fs: ActionFs & DiscoveryFs;
  variables: Record<string, string | undefined>;
  onRefresh: () => Promise<PlanEntry[]>;
  promptSaveReason?: (entry: PlanEntry) => Promise<string | null>;
  loadDetailMarkdown?: (entry: PlanEntry, fs: ActionFs & DiscoveryFs) => Promise<string>;
}

export function buildPlanExplorerConfig(
  options: BuildPlanExplorerConfigOptions
): ExplorerConfig<void> {
  const loadDetailMarkdown = options.loadDetailMarkdown ?? loadPlanPreviewMarkdown;
  const promptSaveReason = options.promptSaveReason ?? promptDefaultSaveReason;
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
      accelerator: "e",
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
      id: "save-for-later",
      accelerator: "s",
      label: "Save/restore",
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        if (isSavedForLaterEntry(entry)) {
          await restorePlanFromLater(entry, options.fs as ActionFs);
          try {
            await ctx.refresh();
            ctx.toast(`Restored ${path.basename(entry.path)}`, "info");
          } catch {
            ctx.toast(`Restored ${path.basename(entry.path)}; refresh failed`, "info");
          }
          return;
        }

        let reason = entry.savedForLater?.reason?.trim();
        if (!reason) {
          const promptedReason = await ctx.suspendAnd(() => promptSaveReason(entry));
          reason = promptedReason?.trim();
        }

        if (!reason) {
          ctx.toast(`Save canceled for ${path.basename(entry.path)}`, "warning");
          return;
        }

        await savePlanForLater(entry, options.fs as ActionFs, { reason });
        try {
          await ctx.refresh();
          ctx.toast(`Saved ${path.basename(entry.path)} for later`, "info");
        } catch {
          ctx.toast(`Saved ${path.basename(entry.path)} for later; refresh failed`, "info");
        }
      }
    },
    {
      id: "archive",
      accelerator: "a",
      label: "Archive",
      destructive: true,
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        await archivePlan(entry, options.fs as ActionFs);
        try {
          await ctx.refresh();
          ctx.toast(`Archived ${path.basename(entry.path)}`, "warning");
        } catch {
          ctx.toast(`Archived ${path.basename(entry.path)}; refresh failed`, "warning");
        }
      }
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        await deletePlan(entry, options.fs as ActionFs);
        try {
          await ctx.refresh();
          ctx.toast(`Deleted ${path.basename(entry.path)}`, "error");
        } catch {
          ctx.toast(`Deleted ${path.basename(entry.path)}; refresh failed`, "error");
        }
      }
    }
  ];

  return normalizeExplorerConfig({
    title: "Plans",
    panes: [
      { id: "plans", kind: "list", title: "Plans", rows: async () => rows, emptyHint: "No plans found", multiSelect: false },
      {
        id: "preview",
        kind: "detail",
        title: "Preview",
        render: async (row, ctx) => {
          if (row === undefined) return "";
          const entry = getEntry(entryByRowId, row.id);
          return await loadMarkdownUnlessAborted(ctx.signal, () => loadDetailMarkdown(entry, options.fs)) ?? "";
        }
      }
    ],
    refresh,
    actions,
    multiSelect: false,
    emptyHint: "No plans found"
  });
}

function toRows(plans: PlanEntry[]): Row[] {
  const rowIds = createRowIds(plans);
  return plans.map((entry, index) => ({
    id: rowIds[index]!,
    title: path.basename(entry.path),
    subtitle: formatSubtitle(entry),
    badge: { text: entry.typeLabel },
    group: isSavedForLaterEntry(entry) ? "Saved for later" : "Active"
  }));
}

function formatSubtitle(entry: PlanEntry): string {
  const reason = entry.savedForLater?.reason?.trim();
  if (isSavedForLaterEntry(entry) && reason) {
    return `${entry.detail} · Later: ${reason}`;
  }

  return entry.detail;
}

function isSavedForLaterEntry(entry: Pick<PlanEntry, "absolutePath">): boolean {
  return path.basename(path.dirname(entry.absolutePath)) === "later";
}

async function promptDefaultSaveReason(entry: PlanEntry): Promise<string | null> {
  const result = await promptText({
    message: `Why save ${path.basename(entry.path)} for later?`
  });

  if (isCancel(result)) {
    return null;
  }

  const reason = result.trim();
  return reason.length > 0 ? reason : null;
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
