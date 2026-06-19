import type { AgentStashContext, AgentStashItem } from "./types.js";

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
