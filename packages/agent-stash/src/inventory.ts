import path from "node:path";
import { getAgentConfig as getHookAgentConfig } from "@poe-code/agent-hook-config";
import { hashFiles, readDirectoryBundle, sha256 } from "./hash.js";
import { hookItemName } from "./hook-items.js";
import { alignHookOrigins, readHookOriginStore } from "./hook-origins.js";
import { isIgnoredSubtree, loadIgnoreMatcher } from "./ignore.js";
import { normalizeAgent, resolveHookRoot, resolveSkillRoot } from "./locations.js";
import { stableItemId, validateManifestItem } from "./manifest.js";
import { selectedHookMatchesName } from "./validation.js";
import type {
  AgentStashContext,
  AgentStashFile,
  AgentStashKind,
  AgentStashScope,
  BundleFile,
  LoadedItem
} from "./types.js";
import { assertNoSymlinkAncestors, assertNotSymlink, isDirectory, pathExists, readFileIfExists } from "./fs-utils.js";

type HookFile = { hooks?: Record<string, unknown> };

export interface InventoryOptions {
  scope: AgentStashScope;
  agent: string;
  skills?: string[];
  hooks?: string[];
  kind?: AgentStashKind;
}

export async function loadInventory(ctx: AgentStashContext, options: InventoryOptions): Promise<LoadedItem[]> {
  const agentId = normalizeAgent(options.agent);
  const includeSkills = options.kind !== "hook" && !isEmptySelection(options.skills);
  const includeHooks = options.kind !== "skill" && !isEmptySelection(options.hooks);
  const [skills, hooks] = await Promise.all([
    includeSkills ? loadSkillInventory(ctx, agentId, options) : Promise.resolve([]),
    includeHooks ? loadHookInventory(ctx, agentId, options) : Promise.resolve([])
  ]);
  return [...skills, ...hooks].sort((left, right) => left.id.localeCompare(right.id));
}

function isEmptySelection(value: string[] | undefined): boolean {
  return value !== undefined && value.length === 0;
}

async function loadSkillInventory(
  ctx: AgentStashContext,
  agentId: string,
  options: InventoryOptions
): Promise<LoadedItem[]> {
  const root = resolveSkillRoot(agentId, options.scope, ctx.cwd, ctx.homeDir);
  if (!root) {
    return [];
  }
  await assertNoSymlinkAncestors(ctx.fs, root, options.scope === "project" ? ctx.cwd : ctx.homeDir);
  await assertNotSymlink(ctx.fs, root);
  if (!(await pathExists(ctx.fs, root))) {
    return [];
  }

  const matcher = await loadIgnoreMatcher(ctx, options.scope);
  const requested = options.skills === undefined ? undefined : new Set(options.skills);
  const names = await ctx.fs.readdir(root);
  const items: LoadedItem[] = [];

  for (const name of [...names].sort()) {
    if (requested !== undefined && !requested.has(name)) {
      continue;
    }
    const skillDir = path.join(root, name);
    const stat = await ctx.fs.stat(skillDir);
    if (!isDirectory(stat)) {
      continue;
    }
    const relativeSkillDir = path.relative(options.scope === "project" ? ctx.cwd : ctx.homeDir, skillDir);
    if (isIgnoredSubtree(matcher, relativeSkillDir.split(path.sep).join("/"))) {
      continue;
    }
    const bundleRoot = `skills/${options.scope}/${agentId}/${name}`;
    const scopeRoot = options.scope === "project" ? ctx.cwd : ctx.homeDir;
    const { bundleFiles, manifestFiles } = await readDirectoryBundle(ctx.fs, skillDir, bundleRoot, (sourcePath) => {
      const relativeSourcePath = path.relative(scopeRoot, sourcePath).split(path.sep).join("/");
      return !matcher.ignores(relativeSourcePath);
    });
    if (manifestFiles.length === 0) {
      continue;
    }
    items.push(createLoadedItem(ctx, {
      kind: "skill",
      scope: options.scope,
      agentId,
      name,
      path: bundleRoot,
      files: manifestFiles,
      bundleFiles,
      targetPath: skillDir
    }));
  }

  return items;
}

async function loadHookInventory(
  ctx: AgentStashContext,
  agentId: string,
  options: InventoryOptions
): Promise<LoadedItem[]> {
  const config = getHookAgentConfig(agentId);
  const hookPath = resolveHookRoot(agentId, options.scope, ctx.cwd, ctx.homeDir);
  if (!config || !hookPath) {
    return [];
  }
  await assertNoSymlinkAncestors(ctx.fs, hookPath, options.scope === "project" ? ctx.cwd : ctx.homeDir);
  await assertNotSymlink(ctx.fs, hookPath);
  const content = await readFileIfExists(ctx.fs, hookPath);
  if (content === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Malformed hooks in ${hookPath}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Malformed hooks in ${hookPath}`);
  }
  const hookFile = parsed as HookFile;
  if (hookFile.hooks !== undefined && !isRecord(hookFile.hooks)) {
    throw new Error(`Malformed hooks in ${hookPath}`);
  }
  const hooks = hookFile.hooks ?? {};
  const requested = options.hooks === undefined ? undefined : new Set(options.hooks);
  const matcher = await loadIgnoreMatcher(ctx, options.scope);
  const scopeRoot = options.scope === "project" ? ctx.cwd : ctx.homeDir;
  const relativeHookPath = path.relative(scopeRoot, hookPath).split(path.sep).join("/");
  if (matcher.ignores(relativeHookPath)) {
    return [];
  }
  const originStore = await readHookOriginStore(ctx);
  const targetOrigins = originStore.targets[hookPath] ?? {};
  const items: LoadedItem[] = [];

  for (const [event, groups] of Object.entries(hooks).sort(([left], [right]) => left.localeCompare(right))) {
    if (!Array.isArray(groups)) {
      throw new Error(`Malformed hooks in ${hookPath}`);
    }
    const groupOrigins = alignHookOrigins(groups, targetOrigins[event] ?? []);
    for (const [groupIndex, group] of groups.entries()) {
      if (!isRecord(group)) {
        throw new Error(`Malformed hooks in ${hookPath}`);
      }
      const groupHooks = group.hooks;
      if (!Array.isArray(groupHooks)) {
        throw new Error(`Malformed hooks in ${hookPath}`);
      }
      const groupOrigin = groupOrigins[groupIndex];
      const originalGroupIndex = groupOrigin?.groupIndex ?? groupIndex;
      const hookOrigins = groupOrigin?.hooks.length === groupHooks.length ? groupOrigin.hooks : [];
      for (const [hookIndex, hook] of groupHooks.entries()) {
        if (!isRecord(hook)) {
          throw new Error(`Malformed hooks in ${hookPath}`);
        }
        const originalHookIndex = hookOrigins[hookIndex] ?? hookIndex;
        const name = hookItemName(event, group.matcher, originalGroupIndex, originalHookIndex);
        if (requested !== undefined && ![...requested].some((selected) => selectedHookMatchesName(name, selected))) {
          continue;
        }
        const bundlePath = `hooks/${options.scope}/${agentId}/${name}.json`;
        if (matcher.ignores(bundlePath)) {
          continue;
        }
        const fragment = {
          agentStash: { hookEvent: event, groupIndex: originalGroupIndex, hookIndex: originalHookIndex },
          hooks: { [event]: [{ ...group, hooks: [hook] }] }
        };
        const fragmentContent = `${JSON.stringify(fragment, null, 2)}\n`;
        const file: AgentStashFile = {
          path: bundlePath,
          size: Buffer.byteLength(fragmentContent, "utf8"),
          sha256: sha256(fragmentContent)
        };
        items.push(createLoadedItem(ctx, {
          kind: "hook",
          scope: options.scope,
          agentId,
          name,
          path: bundlePath,
          files: [file],
          bundleFiles: [{ path: bundlePath, content: fragmentContent }],
          targetPath: hookPath
        }));
      }
    }
  }

  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createLoadedItem(
  ctx: AgentStashContext,
  input: {
    kind: AgentStashKind;
    scope: AgentStashScope;
    agentId: string;
    name: string;
    path: string;
    files: AgentStashFile[];
    bundleFiles: BundleFile[];
    targetPath: string;
  }
): LoadedItem {
  const updatedAt = (ctx.now?.() ?? new Date()).toISOString();
  const item: LoadedItem = {
    id: stableItemId(input),
    kind: input.kind,
    agentId: input.agentId,
    name: input.name,
    scope: input.scope,
    path: input.path,
    files: input.files,
    updatedAt,
    contentHash: hashFiles(input.files),
    bundleFiles: input.bundleFiles,
    targetPath: input.targetPath
  };
  validateManifestItem(item);
  return item;
}
