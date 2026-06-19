import path from "node:path";
import { assertNoSymlinkAncestors, assertNotSymlink, readFileIfExists, writeTextFile } from "./fs-utils.js";
import { agentStashDir } from "./locations.js";
import type { AgentStashContext } from "./types.js";

export type HookOriginStore = {
  targets: Record<string, Record<string, HookOriginGroup[]>>;
};

export type HookOriginGroup = {
  groupIndex: number;
  hooks: number[];
};

export async function readHookOriginStore(ctx: AgentStashContext): Promise<HookOriginStore> {
  const content = await readFileIfExists(ctx.fs, hookOriginsPath(ctx));
  if (content === null) {
    return { targets: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Malformed hook origin cache.");
  }
  if (!isRecord(parsed) || !isRecord(parsed.targets)) {
    throw new Error("Malformed hook origin cache.");
  }
  const targets: HookOriginStore["targets"] = {};
  for (const [targetPath, target] of Object.entries(parsed.targets)) {
    if (!isRecord(target)) {
      throw new Error("Malformed hook origin cache.");
    }
    const events: Record<string, HookOriginGroup[]> = {};
    for (const [event, groups] of Object.entries(target)) {
      if (!Array.isArray(groups)) {
        throw new Error("Malformed hook origin cache.");
      }
      events[event] = groups.map((group) => {
        if (!isRecord(group) || !isNonNegativeInteger(group.groupIndex) || !Array.isArray(group.hooks)) {
          throw new Error("Malformed hook origin cache.");
        }
        return {
          groupIndex: group.groupIndex,
          hooks: group.hooks.map((hookIndex) => {
            if (!isNonNegativeInteger(hookIndex)) {
              throw new Error("Malformed hook origin cache.");
            }
            return hookIndex;
          })
        };
      });
    }
    targets[targetPath] = events;
  }
  return { targets };
}

export async function writeHookOriginStore(ctx: AgentStashContext, store: HookOriginStore): Promise<void> {
  pruneHookOriginStore(store);
  const root = agentStashDir(ctx.homeDir);
  const targetPath = hookOriginsPath(ctx);
  await assertNotSymlink(ctx.fs, root);
  await assertNoSymlinkAncestors(ctx.fs, targetPath, root);
  await assertNotSymlink(ctx.fs, targetPath);
  await writeTextFile(ctx.fs, targetPath, `${JSON.stringify({ version: 1, targets: store.targets }, null, 2)}\n`);
}

export function clearHookOrigins(store: HookOriginStore, targetPath: string, events: readonly string[]): void {
  const target = store.targets[targetPath];
  if (!target) {
    return;
  }
  for (const event of events) {
    delete target[event];
  }
}

function pruneHookOriginStore(store: HookOriginStore): void {
  for (const [targetPath, target] of Object.entries(store.targets)) {
    for (const [event, groups] of Object.entries(target)) {
      if (groups.length === 0) {
        delete target[event];
      }
    }
    if (Object.keys(target).length === 0) {
      delete store.targets[targetPath];
    }
  }
}

function hookOriginsPath(ctx: AgentStashContext): string {
  return path.join(agentStashDir(ctx.homeDir), "hook-origins.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
