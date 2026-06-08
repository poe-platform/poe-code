import { openExternal, type Action } from "toolcraft-design";
import { editFile } from "@poe-code/plan-browser";
import type { Task } from "@poe-code/task-list";

export interface BuildOpenSourceActionOptions {
  taskByRowId: () => ReadonlyMap<string, Task>;
  variables: Record<string, string | undefined>;
}

export interface BuildOpenIssueActionOptions {
  taskByRowId: () => ReadonlyMap<string, Task>;
}

export function buildOpenSourceAction(options: BuildOpenSourceActionOptions): Action<void> {
  return {
    id: "open-source",
    key: "o",
    label: "Open in $EDITOR",
    predicate: (ctx) => getTask(options.taskByRowId(), ctx.row.id).sourcePath != null,
    handler: async (ctx) => {
      const task = getTask(options.taskByRowId(), ctx.row.id);
      await ctx.suspendAnd(async () => {
        editFile(task.sourcePath!, { env: options.variables });
      });
      await ctx.refresh();
      ctx.toast(`Edited ${task.qualifiedId}`, "info");
    }
  };
}

export function buildOpenIssueAction(options: BuildOpenIssueActionOptions): Action<void> {
  return {
    id: "open-issue",
    key: "g",
    label: "Open issue in browser",
    predicate: (ctx) => getIssueUrl(getTask(options.taskByRowId(), ctx.row.id)) !== null,
    handler: async (ctx) => {
      const task = getTask(options.taskByRowId(), ctx.row.id);
      const url = getIssueUrl(task);
      if (url === null) {
        ctx.toast("No issue URL available.", "info");
        return;
      }

      await ctx.suspendAnd(async () => {
        await openExternal(url);
      });
      ctx.toast(`Opened ${task.qualifiedId}`, "info");
    }
  };
}

function getIssueUrl(task: Task): string | null {
  const url = task.metadata.url;
  if (typeof url !== "string") {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function getTask(taskByRowId: ReadonlyMap<string, Task>, rowId: string): Task {
  const task = taskByRowId.get(rowId);
  if (task === undefined) {
    throw new Error(`Task row is no longer available: ${rowId}`);
  }
  return task;
}
