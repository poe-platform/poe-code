import path from "node:path";
import { getAgentConfig as getHookAgentConfig } from "@poe-code/agent-hook-config";
import { hookItemName } from "./hook-items.js";
import { clearHookOrigins, readHookOriginStore, writeHookOriginStore, type HookOriginGroup } from "./hook-origins.js";
import { isIgnoredSubtree, type IgnoreMatcher } from "./ignore.js";
import { normalizeAgent, resolveHookRoot, resolveSkillRoot } from "./locations.js";
import { localPathForBundleFile } from "./bundle.js";
import { selectedHookMatchesName } from "./validation.js";
import { assertNoSymlinkAncestors, assertNotSymlink, isDirectory, pathExists, readFileIfExists, removePath, writeTextFile } from "./fs-utils.js";
import type { AgentStashContext, AgentStashItem, AgentStashScope, BundleFile } from "./types.js";

type HookFile = { agentStash?: unknown; hooks?: Record<string, unknown> };
type HookGroup = Record<string, unknown> & { hooks?: unknown };
type HookFragment = HookFile & {
  event: string;
  groups: unknown[];
  position?: { groupIndex: number; hookIndex: number };
};

export function targetPathForItem(ctx: AgentStashContext, item: AgentStashItem, scope = item.scope): string {
  const agentId = normalizeAgent(item.agentId);
  if (item.kind === "skill") {
    const root = resolveSkillRoot(agentId, scope, ctx.cwd, ctx.homeDir);
    if (!root) {
      throw new Error(`Agent does not support skills: ${agentId}`);
    }
    return path.join(root, item.name);
  }
  const target = resolveHookRoot(agentId, scope, ctx.cwd, ctx.homeDir);
  if (!target) {
    throw new Error(`Agent does not support hooks: ${agentId}`);
  }
  return target;
}

export function isLocalTargetIgnored(
  ctx: AgentStashContext,
  matcher: IgnoreMatcher,
  item: AgentStashItem,
  scope: AgentStashScope = item.scope
): boolean {
  const scopeRoot = scope === "project" ? ctx.cwd : ctx.homeDir;
  const relativeTarget = path.relative(scopeRoot, targetPathForItem(ctx, item, scope)).split(path.sep).join("/");
  return item.kind === "skill"
    ? isIgnoredSubtree(matcher, relativeTarget)
    : matcher.ignores(relativeTarget);
}

export async function writeItemToLocal(
  ctx: AgentStashContext,
  item: AgentStashItem,
  files: readonly BundleFile[],
  scope: AgentStashScope = item.scope
): Promise<string[]> {
  const targetPath = targetPathForItem(ctx, item, scope);
  await assertNoSymlinkAncestors(ctx.fs, targetPath, localWriteRoot(ctx, scope));
  await assertNotSymlink(ctx.fs, targetPath);
  if (item.kind === "skill") {
    const written: string[] = [];
    await removePath(ctx.fs, targetPath);
    for (const file of files) {
      const localPath = localPathForBundleFile(item.path, file.path, targetPath);
      await assertNotSymlink(ctx.fs, localPath);
      await writeTextFile(ctx.fs, localPath, file.content);
      written.push(localPath);
    }
    return written;
  }

  const fragmentContent = files[0]?.content;
  if (fragmentContent === undefined) {
    throw new Error(`Hook item ${item.id} has no fragment file.`);
  }
  const fragment = parseHookFragment(item, files);
  const existingContent = await readFileIfExists(ctx.fs, targetPath);
  const existing = existingContent === null ? {} : parseExistingHookConfig(targetPath, existingContent);
  const originStore = await readHookOriginStore(ctx);
  if (fragment.position) {
    const merged = mergeIndividualHook(existing.hooks ?? {}, fragment, originStore.targets[targetPath]?.[fragment.event] ?? []);
    existing.hooks = merged.hooks;
    originStore.targets[targetPath] ??= {};
    originStore.targets[targetPath][fragment.event] = merged.origins;
  } else {
    existing.hooks = { ...(existing.hooks ?? {}), ...(fragment.hooks ?? {}) };
    clearHookOrigins(originStore, targetPath, Object.keys(fragment.hooks ?? {}));
  }
  await writeTextFile(ctx.fs, targetPath, `${JSON.stringify(existing, null, 2)}\n`);
  await writeHookOriginStore(ctx, originStore);
  return [targetPath];
}

export function validateItemForLocalWrite(item: AgentStashItem, files: readonly BundleFile[]): void {
  if (item.kind === "hook") {
    parseHookFragment(item, files);
  }
}

export async function validateTargetForLocalWrite(
  ctx: AgentStashContext,
  item: AgentStashItem,
  scope: AgentStashScope = item.scope
): Promise<void> {
  const targetPath = targetPathForItem(ctx, item, scope);
  await assertNoSymlinkAncestors(ctx.fs, targetPath, localWriteRoot(ctx, scope));
  await assertNotSymlink(ctx.fs, targetPath);
  if (item.kind === "skill") {
    await validateRemovableSkillTarget(ctx, targetPath, "replace");
    return;
  }
  if (item.kind === "hook") {
    const existingContent = await readFileIfExists(ctx.fs, targetPath);
    if (existingContent !== null) {
      parseExistingHookConfig(targetPath, existingContent);
    }
  }
}

export async function validateTargetForLocalRemove(ctx: AgentStashContext, item: AgentStashItem): Promise<void> {
  const targetPath = targetPathForItem(ctx, item);
  await assertNoSymlinkAncestors(ctx.fs, targetPath, localWriteRoot(ctx, item.scope));
  await assertNotSymlink(ctx.fs, targetPath);
  if (item.kind === "skill") {
    await validateRemovableSkillTarget(ctx, targetPath, "remove");
    return;
  }
  const config = getHookAgentConfig(item.agentId);
  if (config && (await pathExists(ctx.fs, targetPath))) {
    parseExistingHookConfig(targetPath, (await ctx.fs.readFile(targetPath, "utf8")) || "{}");
  }
}

async function validateRemovableSkillTarget(
  ctx: AgentStashContext,
  targetPath: string,
  action: "replace" | "remove"
): Promise<void> {
  if (ctx.fs.rm || !(await pathExists(ctx.fs, targetPath))) {
    return;
  }
  const stat = await ctx.fs.stat(targetPath);
  if (isDirectory(stat)) {
    throw new Error(`Filesystem rm support is required to ${action} skill directory: ${targetPath}`);
  }
}

function parseHookFragment(item: AgentStashItem, files: readonly BundleFile[]): HookFragment {
  const fragmentContent = files[0]?.content;
  if (fragmentContent === undefined) {
    throw new Error(`Hook item ${item.id} has no fragment file.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fragmentContent) as unknown;
  } catch {
    throw new Error(`Malformed hook fragment for ${item.name}.`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Malformed hook fragment for ${item.name}.`);
  }
  const fragment = parsed as HookFile;
  if (fragment.hooks !== undefined && !isRecord(fragment.hooks)) {
    throw new Error(`Malformed hook fragment for ${item.name}.`);
  }
  const eventNames = Object.keys(fragment.hooks ?? {});
  if (eventNames.length === 0) {
    const expectedEvent = isRecord(fragment.agentStash) && typeof fragment.agentStash.hookEvent === "string"
      ? fragment.agentStash.hookEvent
      : item.name;
    throw new Error(`Hook fragment ${item.name} must contain hook event ${expectedEvent}.`);
  }
  const eventName = eventNames[0]!;
  for (const candidate of eventNames) {
    if (candidate !== eventName) {
      throw new Error(`Hook fragment ${item.name} cannot modify hook event ${candidate}.`);
    }
  }
  const position = parseHookFragmentPosition(fragment.agentStash, item.name, eventName);
  if (position === undefined && !selectedHookMatchesName(item.name, eventName)) {
    throw new Error(`Hook fragment ${item.name} cannot modify hook event ${eventName}.`);
  }
  const ownEvent = fragment.hooks?.[eventName];
  if (ownEvent === undefined) {
    throw new Error(`Hook fragment ${item.name} must contain hook event ${eventName}.`);
  }
  if (!Array.isArray(ownEvent)) {
    throw new Error(`Malformed hook fragment for ${item.name}.`);
  }
  if (position !== undefined) {
    if (ownEvent.length !== 1) {
      throw new Error(`Malformed hook fragment for ${item.name}.`);
    }
    const group = ownEvent[0];
    if (!isRecord(group) || !Array.isArray(group.hooks) || group.hooks.length !== 1 || !isRecord(group.hooks[0])) {
      throw new Error(`Malformed hook fragment for ${item.name}.`);
    }
  }
  return { ...fragment, event: eventName, groups: ownEvent, position };
}

function parseHookFragmentPosition(metadata: unknown, itemName: string, eventName: string): HookFragment["position"] | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  if (!isRecord(metadata)) {
    throw new Error(`Malformed hook fragment for ${itemName}.`);
  }
  if (metadata.hookEvent !== eventName) {
    throw new Error(`Hook fragment ${itemName} cannot modify hook event ${String(metadata.hookEvent)}.`);
  }
  if (!isNonNegativeInteger(metadata.groupIndex) || !isNonNegativeInteger(metadata.hookIndex)) {
    throw new Error(`Malformed hook fragment for ${itemName}.`);
  }
  return { groupIndex: metadata.groupIndex, hookIndex: metadata.hookIndex };
}

function mergeIndividualHook(
  hooks: Record<string, unknown>,
  fragment: HookFragment,
  origins: readonly HookOriginGroup[]
): { hooks: Record<string, unknown>; origins: HookOriginGroup[] } {
  const eventGroups = cloneUnknownArray(hooks[fragment.event]);
  const sourceGroup = fragment.groups[0];
  if (!fragment.position || !isRecord(sourceGroup) || !Array.isArray(sourceGroup.hooks) || !isRecord(sourceGroup.hooks[0])) {
    throw new Error(`Malformed hook fragment for ${fragment.event}.`);
  }
  const hasStoredOrigins = originsMatchEventGroups(eventGroups, origins);
  const originGroups = normalizeHookOrigins(eventGroups, origins);
  const sourceGroupFields = cloneRecordWithoutHooks(sourceGroup);
  const targetGroup = targetGroupForMerge(
    eventGroups,
    hasStoredOrigins ? originGroups : [],
    fragment.position.groupIndex,
    sourceGroupFields
  );
  const existingGroupCandidate = targetGroup.insert ? undefined : eventGroups[targetGroup.index];
  const existingGroup = isRecord(existingGroupCandidate)
    ? cloneRecord(existingGroupCandidate)
    : {};
  const nextGroup: HookGroup = { ...existingGroup, ...sourceGroupFields };
  const groupHooks = Array.isArray(existingGroup.hooks) ? [...existingGroup.hooks] : [];
  const existingHookOrigins = targetGroup.insert
    ? []
    : hasStoredOrigins
      ? originGroups[targetGroup.index]?.hooks ?? []
      : defaultHookOriginsForInsert(groupHooks.length, fragment.position.hookIndex);
  const targetHook = targetHookForMerge(groupHooks, hasStoredOrigins ? existingHookOrigins : [], fragment.position.hookIndex);
  if (targetHook.insert) {
    groupHooks.splice(targetHook.index, 0, cloneJson(sourceGroup.hooks[0]));
  } else {
    groupHooks[targetHook.index] = cloneJson(sourceGroup.hooks[0]);
  }
  nextGroup.hooks = groupHooks;
  const nextGroupOrigin: HookOriginGroup = {
    groupIndex: fragment.position.groupIndex,
    hooks: mergeHookOrigins(existingHookOrigins, targetHook, fragment.position.hookIndex)
  };
  if (targetGroup.insert) {
    if (!hasStoredOrigins) {
      shiftGroupOriginsForInsert(originGroups, fragment.position.groupIndex);
    }
    eventGroups.splice(targetGroup.index, 0, nextGroup);
    originGroups.splice(targetGroup.index, 0, nextGroupOrigin);
  } else {
    eventGroups[targetGroup.index] = nextGroup;
    originGroups[targetGroup.index] = nextGroupOrigin;
  }
  return { hooks: { ...hooks, [fragment.event]: eventGroups }, origins: originGroups };
}

function targetGroupForMerge(
  eventGroups: readonly unknown[],
  origins: readonly HookOriginGroup[],
  groupIndex: number,
  sourceGroupFields: Record<string, unknown>
): { index: number; insert: boolean } {
  const existingOriginIndex = origins.findIndex((origin) => origin.groupIndex === groupIndex);
  if (existingOriginIndex !== -1) {
    return hookGroupFieldsMatch(eventGroups[existingOriginIndex], sourceGroupFields)
      ? { index: existingOriginIndex, insert: false }
      : { index: existingOriginIndex, insert: true };
  }
  if (origins.length > 0) {
    const insertIndex = origins.findIndex((origin) => origin.groupIndex > groupIndex);
    return { index: insertIndex === -1 ? eventGroups.length : insertIndex, insert: true };
  }
  if (groupIndex < eventGroups.length && hookGroupFieldsMatch(eventGroups[groupIndex], sourceGroupFields)) {
    return { index: groupIndex, insert: false };
  }
  return { index: Math.min(groupIndex, eventGroups.length), insert: true };
}

function hookGroupFieldsMatch(candidate: unknown, sourceGroupFields: Record<string, unknown>): boolean {
  return isRecord(candidate) && JSON.stringify(cloneRecordWithoutHooks(candidate)) === JSON.stringify(sourceGroupFields);
}

function normalizeHookOrigins(eventGroups: readonly unknown[], origins: readonly HookOriginGroup[]): HookOriginGroup[] {
  if (origins.length === eventGroups.length) {
    return origins.map((origin) => ({ groupIndex: origin.groupIndex, hooks: [...origin.hooks] }));
  }
  return eventGroups.map((group, groupIndex) => ({
    groupIndex,
    hooks: isRecord(group) && Array.isArray(group.hooks)
      ? group.hooks.map((_, hookIndex) => hookIndex)
      : []
  }));
}

function originsMatchEventGroups(eventGroups: readonly unknown[], origins: readonly HookOriginGroup[]): boolean {
  return origins.length === eventGroups.length && origins.every((origin, groupIndex) => {
    const group = eventGroups[groupIndex];
    return isRecord(group) && Array.isArray(group.hooks) && origin.hooks.length === group.hooks.length;
  });
}

function defaultHookOriginsForInsert(hookCount: number, insertedHookIndex: number): number[] {
  return Array.from({ length: hookCount }, (_, index) => index >= insertedHookIndex ? index + 1 : index);
}

function shiftGroupOriginsForInsert(origins: HookOriginGroup[], insertedGroupIndex: number): void {
  for (const origin of origins) {
    if (origin.groupIndex >= insertedGroupIndex) {
      origin.groupIndex += 1;
    }
  }
}

function targetHookForMerge(
  groupHooks: readonly unknown[],
  origins: readonly number[],
  hookIndex: number
): { index: number; insert: boolean } {
  const normalizedOrigins = origins.length === groupHooks.length ? origins : [];
  const existingOriginIndex = normalizedOrigins.indexOf(hookIndex);
  if (existingOriginIndex !== -1) {
    return { index: existingOriginIndex, insert: false };
  }
  if (normalizedOrigins.length > 0) {
    const insertIndex = normalizedOrigins.findIndex((origin) => origin > hookIndex);
    return { index: insertIndex === -1 ? groupHooks.length : insertIndex, insert: true };
  }
  return { index: Math.min(hookIndex, groupHooks.length), insert: true };
}

function mergeHookOrigins(
  origins: readonly number[],
  target: { index: number; insert: boolean },
  hookIndex: number
): number[] {
  const next = [...origins];
  if (target.insert) {
    next.splice(target.index, 0, hookIndex);
    return next;
  }
  next[target.index] = hookIndex;
  return next;
}

function parseExistingHookConfig(targetPath: string, content: string): HookFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Malformed hooks in ${targetPath}`);
  }
  if (!isRecord(parsed) || (parsed.hooks !== undefined && !isRecord(parsed.hooks))) {
    throw new Error(`Malformed hooks in ${targetPath}`);
  }
  return parsed as HookFile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function removeLocalItem(ctx: AgentStashContext, item: AgentStashItem): Promise<void> {
  const targetPath = targetPathForItem(ctx, item);
  await assertNoSymlinkAncestors(ctx.fs, targetPath, localWriteRoot(ctx, item.scope));
  await assertNotSymlink(ctx.fs, targetPath);
  if (item.kind === "skill") {
    await removePath(ctx.fs, targetPath);
    return;
  }
  const config = getHookAgentConfig(item.agentId);
  if (!config || !(await pathExists(ctx.fs, targetPath))) {
    return;
  }
  const existing = parseExistingHookConfig(targetPath, (await ctx.fs.readFile(targetPath, "utf8")) || "{}");
  const originStore = await readHookOriginStore(ctx);
  const targetOrigins = originStore.targets[targetPath] ?? {};
  if (existing.hooks) {
    const position = findIndividualHookPosition(existing.hooks, item.name, targetOrigins);
    if (position) {
      removeIndividualHook(existing.hooks, position);
      removeHookOrigin(targetOrigins, position);
    } else {
      delete existing.hooks[item.name];
      delete targetOrigins[item.name];
    }
  }
  await writeTextFile(ctx.fs, targetPath, `${JSON.stringify(existing, null, 2)}\n`);
  await writeHookOriginStore(ctx, originStore);
}

function removeIndividualHook(
  hooks: Record<string, unknown>,
  position: { event: string; groupIndex: number; hookIndex: number }
): void {
  const groups = hooks[position.event];
  if (!Array.isArray(groups)) {
    return;
  }
  const group = groups[position.groupIndex];
  if (!isRecord(group) || !Array.isArray(group.hooks)) {
    return;
  }
  group.hooks.splice(position.hookIndex, 1);
  if (group.hooks.length === 0) {
    groups.splice(position.groupIndex, 1);
  }
  if (groups.length === 0) {
    delete hooks[position.event];
  }
}

function findIndividualHookPosition(
  hooks: Record<string, unknown>,
  name: string,
  origins: Record<string, HookOriginGroup[]> = {}
): { event: string; groupIndex: number; hookIndex: number } | undefined {
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      continue;
    }
    const groupOrigins = origins[event]?.length === groups.length ? origins[event] : [];
    for (const [groupIndex, group] of groups.entries()) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        continue;
      }
      const groupOrigin = groupOrigins[groupIndex];
      const originalGroupIndex = groupOrigin?.groupIndex ?? groupIndex;
      const hookOrigins = groupOrigin?.hooks.length === group.hooks.length ? groupOrigin.hooks : [];
      for (const [hookIndex] of group.hooks.entries()) {
        const originalHookIndex = hookOrigins[hookIndex] ?? hookIndex;
        if (hookItemName(event, group.matcher, originalGroupIndex, originalHookIndex) === name) {
          return { event, groupIndex, hookIndex };
        }
      }
    }
  }
  return undefined;
}

function removeHookOrigin(
  origins: Record<string, HookOriginGroup[]>,
  position: { event: string; groupIndex: number; hookIndex: number }
): void {
  const groups = origins[position.event];
  if (!Array.isArray(groups)) {
    return;
  }
  const group = groups[position.groupIndex];
  if (!group) {
    return;
  }
  group.hooks.splice(position.hookIndex, 1);
  if (group.hooks.length === 0) {
    groups.splice(position.groupIndex, 1);
  }
  if (groups.length === 0) {
    delete origins[position.event];
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cloneUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function cloneRecordWithoutHooks(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key !== "hooks") {
      result[key] = cloneJson(fieldValue);
    }
  }
  return result;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function localWriteRoot(ctx: AgentStashContext, scope: AgentStashScope): string {
  return scope === "project" ? ctx.cwd : ctx.homeDir;
}
