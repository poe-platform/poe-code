import path from "node:path";
import { formatPlanReadinessLabel } from "@poe-code/agent-harness-tools";
import type { Action, ExplorerConfig, Row } from "toolcraft-design";
import { normalizeExplorerConfig } from "toolcraft-design";
import {
  archivePlan,
  deletePlan,
  editFile,
  restorePlanFromLater,
  savePlanForLater,
  setPlanReadiness
} from "./actions.js";
import { loadPlanPreviewMarkdown } from "./format.js";
import type { ActionFs, DiscoveryFs, PlanEntry } from "./types.js";

export interface BuildPlanExplorerConfigOptions {
  plans: PlanEntry[];
  archived?: boolean;
  fs: ActionFs & DiscoveryFs;
  variables: Record<string, string | undefined>;
  homeDir?: string;
  onRefresh: () => Promise<PlanEntry[]>;
  promptSaveReason?: (entry: PlanEntry) => Promise<string | null>;
  loadDetailMarkdown?: (entry: PlanEntry, fs: ActionFs & DiscoveryFs) => Promise<string>;
}

export function buildPlanExplorerConfig(
  options: BuildPlanExplorerConfigOptions
): ExplorerConfig<void> {
  const loadDetailMarkdown = options.loadDetailMarkdown ?? loadPlanPreviewMarkdown;
  const promptSaveReason = options.promptSaveReason;
  let plans = options.plans;
  let rows = toRows(plans, options.archived);
  let entryByRowId = toEntryMap(plans);
  let preserveOrderOnNextRefresh = false;

  async function refresh(): Promise<void> {
    const refreshedPlans = await options.onRefresh();
    plans = preserveOrderOnNextRefresh ? preservePlanOrder(plans, refreshedPlans) : refreshedPlans;
    preserveOrderOnNextRefresh = false;
    rows = toRows(plans, options.archived);
    entryByRowId = toEntryMap(plans);
  }

  const actions: Action<void>[] = [
    {
      id: "readiness",
      accelerator: "r",
      label: "Mark ready/draft",
      handler: async (ctx) => {
        const entry = getEntry(entryByRowId, ctx.row.id);
        const readiness = entry.readiness === "ready" ? "draft" : "ready";
        await setPlanReadiness(entry.absolutePath, readiness, options.fs as ActionFs);
        preserveOrderOnNextRefresh = true;
        try {
          await ctx.refresh();
        } finally {
          preserveOrderOnNextRefresh = false;
        }
        ctx.toast(`Marked ${path.basename(entry.path)} ${readiness}`, "info");
      }
    },
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
          const promptedReason =
            promptSaveReason === undefined
              ? await ctx.promptText({
                  title: "Save plan for later",
                  label: "Why are you saving this plan for later?",
                  placeholder: "Reason"
                })
              : await promptSaveReason(entry);
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
      accelerator: "x",
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
    mouse: false,
    panes: [
      {
        id: "plans",
        kind: "list",
        title: "Plans",
        rows: async () => rows,
        emptyHint: "No plans found",
        multiSelect: false
      },
      {
        id: "plan",
        kind: "detail",
        title: "Plan",
        titleForRow: (row) =>
          row === undefined
            ? "Plan"
            : abbreviateHome(entryByRowId.get(row.id)?.absolutePath ?? row.id, options.homeDir),
        render: async (row, ctx) => {
          if (row === undefined) return "";
          const entry = getEntry(entryByRowId, row.id);
          return (
            (await loadMarkdownUnlessAborted(ctx.signal, () =>
              loadDetailMarkdown(entry, options.fs)
            )) ?? ""
          );
        }
      }
    ],
    refresh,
    actions: options.archived
      ? actions.filter((action) => action.id === "edit" || action.id === "delete")
      : actions,
    ...(options.archived
      ? {}
      : {
          reorder: {
            onReorder: async (orderedIds, ctx) => {
              if (ctx === undefined) {
                throw new Error("Plan reorder context is required");
              }
              const orderedEntries = orderedIds.map((id) => getEntry(entryByRowId, id));
              const movedIndex = orderedIds.indexOf(ctx.movedId);
              const originalIndex = createRowIds(plans).indexOf(ctx.movedId);
              if (movedIndex < 0 || originalIndex < 0) {
                throw new Error(`Plan row is no longer available: ${ctx.movedId}`);
              }
              const moved = orderedEntries[movedIndex]!;
              const swapTarget = orderedEntries[originalIndex];
              if (swapTarget === undefined || swapTarget.readiness !== moved.readiness) {
                throw new Error("Plans can only be reordered within the same readiness group");
              }
              if (isSavedForLaterEntry(swapTarget) !== isSavedForLaterEntry(moved)) {
                throw new Error("Active and saved-for-later plans cannot be reordered together");
              }
              const previousCandidate = orderedEntries[movedIndex - 1];
              const nextCandidate = orderedEntries[movedIndex + 1];
              const previous = sameOrderingGroup(previousCandidate, moved)
                ? previousCandidate
                : undefined;
              const next = sameOrderingGroup(nextCandidate, moved) ? nextCandidate : undefined;

              const [movedStat, previousStat, nextStat] = await Promise.all([
                options.fs.stat(moved.absolutePath),
                previous === undefined ? undefined : options.fs.stat(previous.absolutePath),
                next === undefined ? undefined : options.fs.stat(next.absolutePath)
              ]);
              const updatedAt = resolveMovedTimestamp(previousStat?.mtimeMs, nextStat?.mtimeMs);
              await options.fs.utimes(
                moved.absolutePath,
                new Date(movedStat.atimeMs ?? movedStat.mtimeMs),
                new Date(updatedAt)
              );
              await ctx.refresh();
              ctx.toast(`Reordered ${path.basename(moved.path)}`, "info");
            }
          }
        }),
    multiSelect: false,
    emptyHint: "No plans found"
  });
}

function sameOrderingGroup(left: PlanEntry | undefined, right: PlanEntry): left is PlanEntry {
  return (
    left !== undefined &&
    left.readiness === right.readiness &&
    isSavedForLaterEntry(left) === isSavedForLaterEntry(right)
  );
}

function resolveMovedTimestamp(previous: number | undefined, next: number | undefined): number {
  if (previous === undefined && next === undefined) return Date.now();
  if (previous === undefined) return next! + 1_000;
  if (next === undefined) return Math.max(0, previous - 1_000);
  if (previous <= next) {
    throw new Error("Could not reorder plans because adjacent modification times are identical");
  }
  return next + (previous - next) / 2;
}

function preservePlanOrder(current: PlanEntry[], refreshed: PlanEntry[]): PlanEntry[] {
  const refreshedByPath = new Map<string, PlanEntry[]>();
  for (const entry of refreshed) {
    const matches = refreshedByPath.get(entry.absolutePath) ?? [];
    matches.push(entry);
    refreshedByPath.set(entry.absolutePath, matches);
  }

  const ordered: PlanEntry[] = [];
  for (const entry of current) {
    const matches = refreshedByPath.get(entry.absolutePath);
    const match = matches?.shift();
    if (match !== undefined) ordered.push(match);
  }

  const remaining = new Set(ordered);
  ordered.push(...refreshed.filter((entry) => !remaining.has(entry)));
  return ordered;
}

function abbreviateHome(filePath: string, homeDir: string | undefined): string {
  if (homeDir === undefined) return filePath;
  const relative = path.relative(homeDir, filePath);
  if (relative === "") return "~";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return filePath;
  }
  return `~${path.sep}${relative}`;
}

function toRows(plans: PlanEntry[], archived = false): Row[] {
  const rowIds = createRowIds(plans);
  return plans.map((entry, index) => ({
    id: rowIds[index]!,
    title: formatPlanReadinessLabel(path.basename(entry.path), entry.readiness),
    subtitle: formatSubtitle(entry),
    badge: { text: entry.typeLabel },
    group: archived ? "Archived" : isSavedForLaterEntry(entry) ? "Saved for later" : "Active"
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
    counts.get(entry.absolutePath) === 1
      ? entry.absolutePath
      : `${entry.absolutePath}\u0000${index}`
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
