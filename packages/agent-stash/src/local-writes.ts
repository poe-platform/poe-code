import path from "node:path";
import { getAgentConfig as getHookAgentConfig } from "@poe-code/agent-hook-config";
import { normalizeAgent, resolveHookRoot, resolveSkillRoot } from "./locations.js";
import { localPathForBundleFile } from "./bundle.js";
import { assertNoSymlinkAncestors, assertNotSymlink, isDirectory, pathExists, readFileIfExists, removePath, writeTextFile } from "./fs-utils.js";
import type { AgentStashContext, AgentStashItem, AgentStashScope, BundleFile } from "./types.js";

type HookFile = { hooks?: Record<string, unknown> };

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
  existing.hooks = { ...(existing.hooks ?? {}), ...(fragment.hooks ?? {}) };
  await writeTextFile(ctx.fs, targetPath, `${JSON.stringify(existing, null, 2)}\n`);
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

function parseHookFragment(item: AgentStashItem, files: readonly BundleFile[]): HookFile {
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
  for (const eventName of Object.keys(fragment.hooks ?? {})) {
    if (eventName !== item.name) {
      throw new Error(`Hook fragment ${item.name} cannot modify hook event ${eventName}.`);
    }
  }
  const ownEvent = fragment.hooks?.[item.name];
  if (ownEvent === undefined) {
    throw new Error(`Hook fragment ${item.name} must contain hook event ${item.name}.`);
  }
  if (!Array.isArray(ownEvent)) {
    throw new Error(`Malformed hook fragment for ${item.name}.`);
  }
  return fragment;
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
  if (existing.hooks) {
    delete existing.hooks[item.name];
  }
  await writeTextFile(ctx.fs, targetPath, `${JSON.stringify(existing, null, 2)}\n`);
}

function localWriteRoot(ctx: AgentStashContext, scope: AgentStashScope): string {
  return scope === "project" ? ctx.cwd : ctx.homeDir;
}
