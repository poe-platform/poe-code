import type { AgentStashItem, AgentStashKind, AgentStashLocationKind, AgentStashScope, ConflictPolicy } from "./types.js";

export function assertAgentStashScope(value: AgentStashScope, label = "scope"): void {
  if (value !== "project" && value !== "global") {
    throw new Error(`Invalid ${label}: ${String(value)}. Expected project or global.`);
  }
}

export function assertAgentStashKind(value: AgentStashKind, label = "kind"): void {
  if (value !== "skill" && value !== "hook") {
    throw new Error(`Invalid ${label}: ${String(value)}. Expected skill or hook.`);
  }
}

export function assertAgentStashLocationKind(value: AgentStashLocationKind, label = "location"): void {
  if (value !== "project" && value !== "global" && value !== "gist" && value !== "archive") {
    throw new Error(`Invalid ${label}: ${String(value)}. Expected project, global, gist, or archive.`);
  }
}

export function assertConflictPolicy(value: ConflictPolicy): void {
  if (value !== "ask" && value !== "local" && value !== "remote" && value !== "newer" && value !== "fail") {
    throw new Error(`Invalid conflict policy: ${String(value)}. Expected ask, local, remote, newer, or fail.`);
  }
}

export function assertSelectedItemsFound(
  items: Array<Pick<AgentStashItem, "kind" | "name">>,
  selected: { skills?: string[]; hooks?: string[] }
): void {
  for (const skill of selected.skills ?? []) {
    if (!items.some((item) => item.kind === "skill" && item.name === skill)) {
      throw new Error(`Selected skill not found: ${skill}`);
    }
  }
  for (const hook of selected.hooks ?? []) {
    if (!items.some((item) => item.kind === "hook" && selectedHookMatchesName(item.name, hook))) {
      throw new Error(`Selected hook not found: ${hook}`);
    }
  }
}

export function selectedHookMatchesName(itemName: string, selectedHook: string): boolean {
  return itemName === selectedHook || itemName.startsWith(`${selectedHook}-`);
}
