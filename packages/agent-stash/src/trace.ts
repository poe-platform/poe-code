import type { AgentStashContext, AgentStashItem, GistWriteInput } from "./types.js";

export async function traceAgentStash(
  ctx: AgentStashContext,
  event: string,
  fields: Record<string, unknown> = {}
): Promise<void> {
  if (!ctx.trace) {
    return;
  }
  await ctx.trace({
    timestamp: (ctx.now?.() ?? new Date()).toISOString(),
    event,
    ...fields
  });
}

export async function traceAgentStashError(
  ctx: AgentStashContext,
  event: string,
  error: unknown
): Promise<void> {
  await traceAgentStash(ctx, event, {
    error: error instanceof Error ? error.message : String(error)
  });
}

export function traceItems(items: AgentStashItem[]): Array<{
  id: string;
  kind: AgentStashItem["kind"];
  scope: AgentStashItem["scope"];
  agentId: string;
  name: string;
}> {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    scope: item.scope,
    agentId: item.agentId,
    name: item.name
  }));
}

export function traceItemSet(items: AgentStashItem[]): {
  itemIds: string[];
  items: ReturnType<typeof traceItems>;
} {
  const tracedItems = traceItems(items);
  return {
    itemIds: tracedItems.map((item) => item.id),
    items: tracedItems
  };
}

export function traceGistWriteInput(writeInput: GistWriteInput): {
  fileWrites: number;
  fileDeletes: number;
  filenames: string[];
  writeFiles: string[];
  deleteFiles: string[];
} {
  const writeFiles = Object.entries(writeInput.files)
    .filter(([, file]) => file !== null)
    .map(([filename]) => filename)
    .sort();
  const deleteFiles = Object.entries(writeInput.files)
    .filter(([, file]) => file === null)
    .map(([filename]) => filename)
    .sort();
  return {
    fileWrites: writeFiles.length,
    fileDeletes: deleteFiles.length,
    filenames: [...new Set([...writeFiles, ...deleteFiles])].sort(),
    writeFiles,
    deleteFiles
  };
}
