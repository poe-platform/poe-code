import { baselineManifestPath, profileConfigPath } from "./locations.js";
import { parseManifest, serializeManifest } from "./manifest.js";
import { assertNoSymlinkAncestors, assertNotSymlink, isDirectory, pathExists, readFileIfExists, removePath, writeTextFile } from "./fs-utils.js";
import type { AgentStashConfig, AgentStashContext, AgentStashManifest, AgentStashProfile } from "./types.js";

export function parseGistRef(ref: string): { gistId: string; gistUrl?: string } {
  let parsed: URL | undefined;
  try {
    parsed = new URL(ref);
  } catch {
    assertValidGistId(ref);
    return { gistId: ref };
  }
  if (parsed.hostname !== "gist.github.com") {
    throw new Error(`Gist URL must use gist.github.com: ${ref}`);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1 && segments.length !== 2) {
    throw new Error(`Unable to extract Gist id from ${ref}`);
  }
  const gistId = segments.length === 1 ? segments[0] : segments[1];
  if (!gistId) {
    throw new Error(`Unable to extract Gist id from ${ref}`);
  }
  assertValidGistId(gistId);
  return { gistId, gistUrl: `https://gist.github.com/${gistId}` };
}

function assertValidGistId(gistId: string): void {
  if (gistId.length === 0 || gistId === "." || gistId === ".." || [...gistId].some((character) => !isGistIdCharacter(character))) {
    throw new Error(`Invalid Gist id: ${gistId}`);
  }
}

function isGistIdCharacter(character: string): boolean {
  return isAsciiAlphaNumeric(character) || character === "." || character === "_" || character === "-";
}

export function assertValidProfileName(name: string): void {
  if (name.length === 0 || !isProfileNameStart(name[0]) || [...name].some((character) => !isProfileNameCharacter(character))) {
    throw new Error(`Invalid profile name: ${name}`);
  }
}

function isProfileNameStart(character: string | undefined): boolean {
  return character !== undefined && isAsciiAlphaNumeric(character);
}

function isProfileNameCharacter(character: string): boolean {
  return isAsciiAlphaNumeric(character) || character === "." || character === "_" || character === "-";
}

function isAsciiAlphaNumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export async function loadConfig(ctx: AgentStashContext): Promise<AgentStashConfig> {
  const content = await readAgentStashFile(ctx, profileConfigPath(ctx.homeDir));
  if (content === null) {
    return { profiles: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Malformed agent stash config.");
  }
  return validateConfig(parsed);
}

function validateConfig(value: unknown): AgentStashConfig {
  if (!isRecord(value)) {
    throw new Error("Agent stash config must be an object.");
  }
  if (value.profiles === undefined) {
    return { profiles: {} };
  }
  if (!isRecord(value.profiles)) {
    throw new Error("Agent stash config profiles must be an object.");
  }
  const profiles: AgentStashConfig["profiles"] = {};
  for (const [name, profile] of Object.entries(value.profiles)) {
    assertValidProfileName(name);
    if (!isRecord(profile) || typeof profile.gistId !== "string") {
      throw new Error(`Invalid profile record: ${name}`);
    }
    assertValidGistId(profile.gistId);
    const validated: AgentStashProfile = { gistId: profile.gistId };
    const gistUrl = optionalProfileGistUrl(profile.gistUrl, name, profile.gistId);
    const lastPulledAt = optionalProfileTimestamp(profile.lastPulledAt, name, "lastPulledAt");
    const lastPushedAt = optionalProfileTimestamp(profile.lastPushedAt, name, "lastPushedAt");
    if (gistUrl !== undefined) {
      validated.gistUrl = gistUrl;
    }
    if (lastPulledAt !== undefined) {
      validated.lastPulledAt = lastPulledAt;
    }
    if (lastPushedAt !== undefined) {
      validated.lastPushedAt = lastPushedAt;
    }
    profiles[name] = validated;
  }
  return { profiles };
}

function optionalProfileString(value: unknown, profileName: string, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid profile ${fieldName}: ${profileName}`);
  }
  return value;
}

function optionalProfileTimestamp(value: unknown, profileName: string, fieldName: string): string | undefined {
  const timestamp = optionalProfileString(value, profileName, fieldName);
  if (timestamp !== undefined) {
    assertExactIsoTimestamp(timestamp, profileName, fieldName);
  }
  return timestamp;
}

function assertExactIsoTimestamp(value: string, profileName: string, fieldName: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`Invalid profile ${fieldName}: ${profileName}`);
  }
}

function optionalProfileGistUrl(value: unknown, profileName: string, gistId: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid profile gistUrl: ${profileName}`);
  }
  const parsed = parseGistRef(value);
  if (parsed.gistId !== gistId) {
    throw new Error(`Profile ${profileName} Gist URL id mismatch: ${value}`);
  }
  return parsed.gistUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function saveConfig(ctx: AgentStashContext, config: AgentStashConfig): Promise<void> {
  const validated = validateConfig(config);
  await writeAgentStashFile(ctx, profileConfigPath(ctx.homeDir), `${JSON.stringify(validated, null, 2)}\n`);
}

export async function addProfile(ctx: AgentStashContext, name: string, gistRef: string): Promise<AgentStashProfile> {
  assertValidProfileName(name);
  const config = await loadConfig(ctx);
  if (hasProfile(config, name)) {
    throw new Error(`Profile already exists: ${name}`);
  }
  const profile = parseGistRef(gistRef);
  config.profiles[name] = profile;
  await saveConfig(ctx, config);
  return profile;
}

export async function removeProfile(ctx: AgentStashContext, name: string): Promise<void> {
  assertValidProfileName(name);
  const config = await loadConfig(ctx);
  if (!hasProfile(config, name)) {
    throw new Error(`Profile not found: ${name}`);
  }
  const baselinePath = baselineManifestPath(ctx.homeDir, name);
  await assertAgentStashFileSafe(ctx, baselinePath);
  delete config.profiles[name];
  await saveConfig(ctx, config);
  await removeAgentStashFile(ctx, baselinePath);
}

export async function renameProfile(ctx: AgentStashContext, oldName: string, newName: string): Promise<void> {
  assertValidProfileName(oldName);
  assertValidProfileName(newName);
  const config = await loadConfig(ctx);
  const profile = getProfile(config, oldName);
  if (!profile) {
    throw new Error(`Profile not found: ${oldName}`);
  }
  if (hasProfile(config, newName)) {
    throw new Error(`Profile already exists: ${newName}`);
  }
  const oldBaseline = await readBaselineManifest(ctx, oldName);
  const newBaselinePath = baselineManifestPath(ctx.homeDir, newName);
  if (oldBaseline) {
    await assertAgentStashFileSafe(ctx, newBaselinePath);
  }
  config.profiles[newName] = profile;
  delete config.profiles[oldName];
  await saveConfig(ctx, config);
  if (oldBaseline) {
    await writeBaselineManifest(ctx, newName, oldBaseline);
    await removeAgentStashFile(ctx, baselineManifestPath(ctx.homeDir, oldName));
  }
}

export async function resolveProfileGist(ctx: AgentStashContext, profile?: string, gist?: string): Promise<{
  profileName?: string;
  gistId?: string;
  gistUrl?: string;
}> {
  if (profile) {
    assertValidProfileName(profile);
  }
  if (gist) {
    return parseGistRef(gist);
  }
  if (!profile) {
    return {};
  }
  const config = await loadConfig(ctx);
  const record = getProfile(config, profile);
  if (!record) {
    return { profileName: profile };
  }
  assertValidGistId(record.gistId);
  return { profileName: profile, gistId: record.gistId, gistUrl: record.gistUrl };
}

export async function recordProfilePush(
  ctx: AgentStashContext,
  profile: string | undefined,
  gistId: string,
  gistUrl: string | undefined,
  timestamp: string
): Promise<void> {
  if (!profile) {
    return;
  }
  assertValidProfileName(profile);
  assertValidGistId(gistId);
  assertExactIsoTimestamp(timestamp, profile, "lastPushedAt");
  const config = await loadConfig(ctx);
  const existing = getProfile(config, profile);
  config.profiles[profile] = {
    ...existing,
    gistId,
    gistUrl: gistUrl ?? (existing?.gistId === gistId ? existing.gistUrl : undefined),
    lastPushedAt: timestamp
  };
  await saveConfig(ctx, config);
}

export async function recordProfilePull(
  ctx: AgentStashContext,
  profile: string | undefined,
  gistId: string,
  gistUrl: string | undefined,
  timestamp: string
): Promise<void> {
  if (!profile) {
    return;
  }
  assertValidProfileName(profile);
  assertValidGistId(gistId);
  assertExactIsoTimestamp(timestamp, profile, "lastPulledAt");
  const config = await loadConfig(ctx);
  const existing = getProfile(config, profile);
  config.profiles[profile] = {
    ...existing,
    gistId,
    gistUrl: gistUrl ?? (existing?.gistId === gistId ? existing.gistUrl : undefined),
    lastPulledAt: timestamp
  };
  await saveConfig(ctx, config);
}

function hasProfile(config: AgentStashConfig, profile: string): boolean {
  return Object.hasOwn(config.profiles, profile);
}

function getProfile(config: AgentStashConfig, profile: string): AgentStashProfile | undefined {
  return hasProfile(config, profile) ? config.profiles[profile] : undefined;
}

export async function readBaselineManifest(ctx: AgentStashContext, profile: string): Promise<AgentStashManifest | null> {
  assertValidProfileName(profile);
  const content = await readAgentStashFile(ctx, baselineManifestPath(ctx.homeDir, profile));
  if (content === null) {
    return null;
  }
  try {
    return parseManifest(content);
  } catch {
    throw new Error(`Malformed baseline manifest for profile ${profile}.`);
  }
}

export async function writeBaselineManifest(
  ctx: AgentStashContext,
  profile: string,
  manifest: AgentStashManifest
): Promise<void> {
  assertValidProfileName(profile);
  await writeAgentStashFile(ctx, baselineManifestPath(ctx.homeDir, profile), serializeManifest(manifest));
}

async function writeAgentStashFile(ctx: AgentStashContext, targetPath: string, content: string): Promise<void> {
  await assertAgentStashFileSafe(ctx, targetPath);
  await writeTextFile(ctx.fs, targetPath, content);
}

async function readAgentStashFile(ctx: AgentStashContext, targetPath: string): Promise<string | null> {
  await assertAgentStashFileSafe(ctx, targetPath);
  return readFileIfExists(ctx.fs, targetPath);
}

async function removeAgentStashFile(ctx: AgentStashContext, targetPath: string): Promise<void> {
  await assertAgentStashFileSafe(ctx, targetPath);
  await removePath(ctx.fs, targetPath);
}

async function assertAgentStashFileSafe(ctx: AgentStashContext, targetPath: string): Promise<void> {
  await assertNoSymlinkAncestors(ctx.fs, targetPath, ctx.homeDir);
  await assertNotSymlink(ctx.fs, targetPath);
  if (await pathExists(ctx.fs, targetPath)) {
    const stat = await ctx.fs.stat(targetPath);
    if (isDirectory(stat)) {
      throw new Error(`Agent stash file path is a directory: ${targetPath}`);
    }
  }
}
