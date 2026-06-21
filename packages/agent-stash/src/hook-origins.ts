import path from "node:path";
import crypto from "node:crypto";
import { assertNoSymlinkAncestors, assertNotSymlink, readFileIfExists, writeTextFile } from "./fs-utils.js";
import { agentStashDir } from "./locations.js";
import type { AgentStashContext } from "./types.js";

export type HookOriginStore = {
  targets: Record<string, Record<string, HookOriginGroup[]>>;
};

export type HookOriginGroup = {
  groupIndex: number;
  hooks: number[];
  groupFieldsHash?: string;
  hookHashes?: string[];
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
    return { targets: {} };
  }
  try {
    return parseHookOriginStore(parsed);
  } catch {
    return { targets: {} };
  }
}

function parseHookOriginStore(parsed: unknown): HookOriginStore {
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
          }),
          ...(typeof group.groupFieldsHash === "string" ? { groupFieldsHash: group.groupFieldsHash } : {}),
          ...(Array.isArray(group.hookHashes) && group.hookHashes.every((hash) => typeof hash === "string")
            ? { hookHashes: [...group.hookHashes] }
            : {})
        };
      });
    }
    targets[targetPath] = events;
  }
  return { targets };
}

export function hookOriginsMatchEventGroups(eventGroups: readonly unknown[], origins: readonly HookOriginGroup[]): boolean {
  return origins.length === eventGroups.length && origins.every((origin, groupIndex) => {
    const group = eventGroups[groupIndex];
    const fingerprints = hookGroupFingerprints(group);
    return origin.hooks.length === fingerprints.hookHashes.length
      && origin.groupFieldsHash === fingerprints.groupFieldsHash
      && arraysEqual(origin.hookHashes, fingerprints.hookHashes);
  });
}

export function alignHookOrigins(eventGroups: readonly unknown[], origins: readonly HookOriginGroup[]): HookOriginGroup[] {
  if (originsMatchEventGroupsByPosition(eventGroups, origins)) {
    return origins.map((origin, groupIndex) => {
      const fingerprints = hookGroupFingerprints(eventGroups[groupIndex]);
      return {
        groupIndex: origin.groupIndex,
        hooks: [...origin.hooks],
        groupFieldsHash: origin.groupFieldsHash ?? fingerprints.groupFieldsHash,
        hookHashes: origin.hookHashes ?? fingerprints.hookHashes
      };
    });
  }
  const usedOrigins = new Set<number>();
  return eventGroups.map((group, groupIndex) => {
    const fingerprints = hookGroupFingerprints(group);
    const originIndex = findMatchingOrigin(fingerprints, origins, usedOrigins);
    if (originIndex === -1) {
      return {
        groupIndex,
        hooks: fingerprints.hookHashes.map((_, hookIndex) => hookIndex),
        groupFieldsHash: fingerprints.groupFieldsHash,
        hookHashes: fingerprints.hookHashes
      };
    }
    usedOrigins.add(originIndex);
    const origin = origins[originIndex]!;
    return {
      groupIndex: origin.groupIndex,
      hooks: alignHookIndexes(fingerprints.hookHashes, origin),
      groupFieldsHash: fingerprints.groupFieldsHash,
      hookHashes: fingerprints.hookHashes
    };
  });
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

function originsMatchEventGroupsByPosition(eventGroups: readonly unknown[], origins: readonly HookOriginGroup[]): boolean {
  return origins.length === eventGroups.length && origins.every((origin, groupIndex) => {
    const group = eventGroups[groupIndex];
    return isRecord(group) && Array.isArray(group.hooks) && origin.hooks.length === group.hooks.length;
  });
}

function findMatchingOrigin(
  fingerprints: { groupFieldsHash: string; hookHashes: string[] },
  origins: readonly HookOriginGroup[],
  usedOrigins: ReadonlySet<number>
): number {
  let partialMatch = -1;
  for (const [index, origin] of origins.entries()) {
    if (usedOrigins.has(index) || origin.groupFieldsHash !== fingerprints.groupFieldsHash || !Array.isArray(origin.hookHashes)) {
      continue;
    }
    if (arraysEqual(origin.hookHashes, fingerprints.hookHashes)) {
      return index;
    }
    if (
      fingerprints.hookHashes.every((hash) => origin.hookHashes?.includes(hash))
      || origin.hookHashes.every((hash) => fingerprints.hookHashes.includes(hash))
    ) {
      partialMatch = index;
    }
  }
  return partialMatch;
}

function alignHookIndexes(hookHashes: readonly string[], origin: HookOriginGroup): number[] {
  const originHashes = origin.hookHashes ?? [];
  const usedOriginHashIndexes = new Set<number>();
  const usedHookIndexes = new Set<number>();
  let nextHookIndex = origin.hooks.reduce((next, hookIndex) => Math.max(next, hookIndex + 1), 0);
  return hookHashes.map((hash, fallbackIndex) => {
    const originHashIndex = originHashes.findIndex((candidate, index) => candidate === hash && !usedOriginHashIndexes.has(index));
    if (originHashIndex === -1) {
      while (usedHookIndexes.has(nextHookIndex)) {
        nextHookIndex += 1;
      }
      const next = Math.max(nextHookIndex, fallbackIndex);
      usedHookIndexes.add(next);
      nextHookIndex = next + 1;
      return next;
    }
    const originalHookIndex = origin.hooks[originHashIndex] ?? fallbackIndex;
    usedOriginHashIndexes.add(originHashIndex);
    usedHookIndexes.add(originalHookIndex);
    return originalHookIndex;
  });
}

export function hookGroupFingerprints(group: unknown): { groupFieldsHash: string; hookHashes: string[] } {
  if (!isRecord(group) || !Array.isArray(group.hooks)) {
    return { groupFieldsHash: stableHash({}), hookHashes: [] };
  }
  const { hooks: ignoredHooks, ...fields } = group;
  void ignoredHooks;
  return {
    groupFieldsHash: stableHash(fields),
    hookHashes: group.hooks.map((hook) => stableHash(hook))
  };
}

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function arraysEqual(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
