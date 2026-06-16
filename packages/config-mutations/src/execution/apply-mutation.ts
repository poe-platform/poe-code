import { randomUUID } from "node:crypto";
import path from "node:path";
import { renderTemplate } from "toolcraft-design";
import type {
  Mutation,
  MutationContext,
  MutationOutcome,
  MutationDetails,
  ConfigObject,
  MutationOptions,
  ValueResolver,
  FileSystem
} from "../types.js";
import { getConfigFormat, detectFormat } from "../formats/index.js";
import { cloneConfigObject, setConfigEntry } from "../formats/object.js";
import { resolvePath } from "./path-utils.js";
import {
  isNotFound,
  readFileIfExists,
  pathExists,
  createTimestamp
} from "../fs-utils.js";
import { hasOwnErrorCode } from "../error-codes.js";

// ============================================================================
// Helper Functions
// ============================================================================

function resolveValue<T>(
  resolver: ValueResolver<T>,
  options: MutationOptions
): T {
  if (typeof resolver === "function") {
    return (resolver as (ctx: MutationOptions) => T)(options);
  }
  return resolver;
}

function createInvalidDocumentBackupPath(targetPath: string): string {
  const ext = targetPath.includes(".") ? targetPath.split(".").pop() : "bak";
  return `${targetPath}.invalid-${createTimestamp()}.${ext}`;
}

async function backupInvalidDocument(
  context: MutationContext,
  targetPath: string,
  content: string
): Promise<void> {
  const baseBackupPath = createInvalidDocumentBackupPath(targetPath);
  let attempt = 0;
  while (true) {
    const backupPath = attempt === 0 ? baseBackupPath : `${baseBackupPath}-${attempt}`;
    await assertRegularWriteTarget(context, backupPath);
    try {
      await context.fs.writeFile(backupPath, content, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        await context.fs.unlink(backupPath).catch(() => undefined);
        throw error;
      }
      attempt += 1;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

async function assertRegularWriteTarget(
  context: MutationContext,
  targetPath: string
): Promise<void> {
  // Symlinks inside the managed home directory are untrusted: an attacker could
  // plant one to redirect a credential/config write outside it. Symlinks at or
  // above home are legitimate system links (e.g. /tmp -> /private/tmp on macOS,
  // /var -> /private/var) and must not block writes, so bound the walk at home.
  const boundary = path.dirname(path.resolve(context.homeDir));
  let currentPath = path.resolve(targetPath);
  while (currentPath !== boundary) {
    try {
      if ((await context.fs.lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`Refusing mutation write through symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return;
    }
    currentPath = parentPath;
  }
}

async function writeAtomically(
  context: MutationContext,
  targetPath: string,
  content: string
): Promise<void> {
  await assertRegularWriteTarget(context, targetPath);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tempPath = `${targetPath}.mutation-tmp-${process.pid}-${randomUUID()}`;
    let tempCreated = false;
    try {
      await assertRegularWriteTarget(context, tempPath);
      await context.fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
      tempCreated = true;
      await context.fs.rename(tempPath, targetPath);
      tempCreated = false;
      return;
    } catch (error) {
      const alreadyExists = isAlreadyExists(error);
      if (tempCreated || !alreadyExists) {
        try {
          await context.fs.unlink(tempPath);
        } catch (cleanupError) {
          if (!isNotFound(cleanupError)) {
            void cleanupError;
          }
        }
      }

      if (alreadyExists) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to create temporary mutation file for ${targetPath}.`);
}

function describeMutation(kind: string, targetPath?: string): string {
  const displayPath = targetPath ?? "target";
  switch (kind) {
    case "ensureDirectory":
      return `Create ${displayPath}`;
    case "removeDirectory":
      return `Remove directory ${displayPath}`;
    case "backup":
      return `Backup ${displayPath}`;
    case "restoreBackup":
      return `Restore ${displayPath}`;
    case "templateWrite":
      return `Write ${displayPath}`;
    case "chmod":
      return `Set permissions on ${displayPath}`;
    case "removeFile":
      return `Remove ${displayPath}`;
    case "configMerge":
    case "configPrune":
    case "configTransform":
    case "templateMergeToml":
    case "templateMergeJson":
      return `Update ${displayPath}`;
    default:
      return "Operation";
  }
}

function mutationTargetPath(
  mutation: Mutation,
  options: MutationOptions
): string | undefined {
  switch (mutation.kind) {
    case "ensureDirectory":
    case "removeDirectory":
      return resolveValue(mutation.path, options);
    case "removeFile":
    case "chmod":
    case "backup":
    case "restoreBackup":
    case "configMerge":
    case "configPrune":
    case "configTransform":
    case "templateWrite":
    case "templateMergeToml":
    case "templateMergeJson":
      return resolveValue(mutation.target, options);
    default:
      return undefined;
  }
}

export function resolveMutationDetails(
  mutation: Mutation,
  context: MutationContext,
  options: MutationOptions
): MutationDetails {
  try {
    const rawTarget = mutationTargetPath(mutation, options);
    if (rawTarget === undefined) {
      return {
        kind: mutation.kind,
        label: mutation.label ?? mutation.kind
      };
    }

    try {
      const targetPath = resolvePath(rawTarget, context.homeDir, context.pathMapper);
      return {
        kind: mutation.kind,
        label: mutation.label ?? describeMutation(mutation.kind, targetPath),
        targetPath
      };
    } catch {
      return {
        kind: mutation.kind,
        label: mutation.label ?? describeMutation(mutation.kind, rawTarget),
        targetPath: undefined
      };
    }
  } catch {
    return {
      kind: mutation.kind,
      label: mutation.label ?? mutation.kind
    };
  }
}

function pruneKeysByPrefix(
  table: ConfigObject,
  prefix: string
): ConfigObject {
  const result: ConfigObject = {};
  for (const [key, value] of Object.entries(table)) {
    if (!key.startsWith(prefix)) {
      setConfigEntry(result, key, value);
    }
  }
  return result;
}

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWithPruneByPrefix(
  base: ConfigObject,
  patch: ConfigObject,
  pruneByPrefix?: Record<string, string>
): ConfigObject {
  const result = cloneConfigObject(base);
  const prefixMap = pruneByPrefix ?? {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const current = result[key];
    const prefix = prefixMap[key];

    if (isConfigObject(current) && isConfigObject(value)) {
      if (prefix) {
        const pruned = pruneKeysByPrefix(current, prefix);
        setConfigEntry(result, key, mergePrunedConfigObject(pruned, value));
      } else {
        setConfigEntry(result, key, mergeWithPruneByPrefix(current, value, prefixMap));
      }
      continue;
    }
    setConfigEntry(result, key, value);
  }
  return result;
}

function mergePrunedConfigObject(base: ConfigObject, patch: ConfigObject): ConfigObject {
  const result = cloneConfigObject(base);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    setConfigEntry(result, key, value);
  }

  return result;
}

function serializeConfigUpdate(
  format: ReturnType<typeof getConfigFormat>,
  rawContent: string | null,
  current: ConfigObject,
  next: ConfigObject
): string {
  if (rawContent !== null && format.serializeUpdate) {
    return format.serializeUpdate(rawContent, current, next);
  }
  return format.serialize(next);
}

// ============================================================================
// Apply Mutation
// ============================================================================

export async function applyMutation(
  mutation: Mutation,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  switch (mutation.kind) {
    case "ensureDirectory":
      return applyEnsureDirectory(mutation, context, options);
    case "removeDirectory":
      return applyRemoveDirectory(mutation, context, options);
    case "removeFile":
      return applyRemoveFile(mutation, context, options);
    case "chmod":
      return applyChmod(mutation, context, options);
    case "backup":
      return applyBackup(mutation, context, options);
    case "restoreBackup":
      return applyRestoreBackup(mutation, context, options);
    case "configMerge":
      return applyConfigMerge(mutation, context, options);
    case "configPrune":
      return applyConfigPrune(mutation, context, options);
    case "configTransform":
      return applyConfigTransform(mutation, context, options);
    case "templateWrite":
      return applyTemplateWrite(mutation, context, options);
    case "templateMergeToml":
      return applyTemplateMerge(mutation, context, options, "toml");
    case "templateMergeJson":
      return applyTemplateMerge(mutation, context, options, "json");
    default: {
      const never: never = mutation;
      throw new Error(`Unknown mutation kind: ${(never as Mutation).kind}`);
    }
  }
}

// ============================================================================
// File Mutation Handlers
// ============================================================================

async function applyEnsureDirectory(
  mutation: Extract<Mutation, { kind: "ensureDirectory" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.path, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  await assertRegularWriteTarget(context, targetPath);
  const existed = await pathExists(context.fs, targetPath);

  if (!context.dryRun) {
    await context.fs.mkdir(targetPath, { recursive: true });
  }

  return {
    outcome: {
      changed: !existed,
      effect: "mkdir",
      detail: existed ? "noop" : "create"
    },
    details
  };
}

async function applyRemoveDirectory(
  mutation: Extract<Mutation, { kind: "removeDirectory" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.path, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  const existed = await pathExists(context.fs, targetPath);
  if (!existed) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  if (typeof context.fs.rm !== "function") {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  if (mutation.force) {
    if (!context.dryRun) {
      await context.fs.rm(targetPath, { recursive: true, force: true });
    }
    return {
      outcome: { changed: true, effect: "delete", detail: "delete" },
      details
    };
  }

  const entries = await context.fs.readdir(targetPath);
  if (entries.length > 0) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  if (!context.dryRun) {
    await context.fs.rm(targetPath, { recursive: true, force: true });
  }

  return {
    outcome: { changed: true, effect: "delete", detail: "delete" },
    details
  };
}

async function applyRemoveFile(
  mutation: Extract<Mutation, { kind: "removeFile" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  try {
    const content = await context.fs.readFile(targetPath, "utf8");
    const trimmed = content.trim();

    // Check whenContentMatches guard
    if (mutation.whenContentMatches) {
      mutation.whenContentMatches.lastIndex = 0;
    }
    if (mutation.whenContentMatches && !mutation.whenContentMatches.test(trimmed)) {
      return {
        outcome: { changed: false, effect: "none", detail: "noop" },
        details
      };
    }

    // Check whenEmpty guard
    if (mutation.whenEmpty && trimmed.length > 0) {
      return {
        outcome: { changed: false, effect: "none", detail: "noop" },
        details
      };
    }

    if (!context.dryRun) {
      await context.fs.unlink(targetPath);
    }

    return {
      outcome: { changed: true, effect: "delete", detail: "delete" },
      details
    };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        outcome: { changed: false, effect: "none", detail: "noop" },
        details
      };
    }
    throw error;
  }
}

async function applyChmod(
  mutation: Extract<Mutation, { kind: "chmod" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  if (typeof context.fs.chmod !== "function") {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  try {
    await assertRegularWriteTarget(context, targetPath);
    const stat = await context.fs.stat(targetPath);
    const currentMode = typeof stat.mode === "number" ? stat.mode & 0o777 : null;

    if (currentMode === mutation.mode) {
      return {
        outcome: { changed: false, effect: "none", detail: "noop" },
        details
      };
    }

    if (!context.dryRun) {
      await context.fs.chmod(targetPath, mutation.mode);
    }

    return {
      outcome: { changed: true, effect: "chmod", detail: "update" },
      details
    };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        outcome: { changed: false, effect: "none", detail: "noop" },
        details
      };
    }
    throw error;
  }
}

async function applyBackup(
  mutation: Extract<Mutation, { kind: "backup" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  await assertRegularWriteTarget(context, targetPath);
  if (mutation.once && (await findLatestGeneratedBackup(context.fs, targetPath)) !== null) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  const content = await readFileIfExists(context.fs, targetPath);
  if (content === null && !mutation.once) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  if (!context.dryRun) {
    const baseBackupPath = `${targetPath}.backup-${createTimestamp()}${content === null ? ".missing" : ""}`;
    let attempt = 0;
    while (true) {
      const backupPath = attempt === 0 ? baseBackupPath : `${baseBackupPath}-${attempt}`;
      try {
        await assertRegularWriteTarget(context, backupPath);
        await context.fs.writeFile(backupPath, content ?? "", { encoding: "utf8", flag: "wx" });
        break;
      } catch (error) {
        if (!isAlreadyExists(error)) {
          await context.fs.unlink(backupPath).catch(() => undefined);
          throw error;
        }
        attempt += 1;
      }
    }
  }

  return {
    outcome: { changed: true, effect: "copy", detail: "backup" },
    details
  };
}

async function applyRestoreBackup(
  mutation: Extract<Mutation, { kind: "restoreBackup" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);
  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };
  const backup = await findLatestGeneratedBackup(context.fs, targetPath);

  if (backup === null) {
    return { outcome: { changed: false, effect: "none", detail: "noop" }, details };
  }

  if (!context.dryRun) {
    await assertRegularWriteTarget(context, backup.path);
    if (backup.originallyMissing) {
      try {
        await context.fs.unlink(targetPath);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    } else {
      const content = await context.fs.readFile(backup.path, "utf8");
      await writeAtomically(context, targetPath, content);
    }
    await context.fs.unlink(backup.path);
  }

  return { outcome: { changed: true, effect: "copy", detail: "restore" }, details };
}

async function findLatestGeneratedBackup(
  fs: FileSystem,
  targetPath: string
): Promise<{ path: string; originallyMissing: boolean } | null> {
  const separatorIndex = targetPath.lastIndexOf("/");
  const directoryPath = separatorIndex <= 0 ? "/" : targetPath.slice(0, separatorIndex);
  const targetName = targetPath.slice(separatorIndex + 1);
  let entries: string[];

  try {
    entries = await fs.readdir(directoryPath);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }

  const backupName = entries
    .filter((entry) => isGeneratedBackupName(entry, targetName))
    .sort()
    .at(-1);
  return backupName === undefined
    ? null
    : {
        path: `${directoryPath}/${backupName}`,
        originallyMissing: backupName.endsWith(".missing")
      };
}

function isGeneratedBackupName(entry: string, targetName: string): boolean {
  const prefix = `${targetName}.backup-`;
  if (!entry.startsWith(prefix)) {
    return false;
  }

  const suffix = entry.slice(prefix.length);
  const timestamp = suffix.slice(0, 24);
  if (timestamp.length !== 24 || timestamp[4] !== "-" || timestamp[7] !== "-" || timestamp[10] !== "T" || timestamp[13] !== "-" || timestamp[16] !== "-" || timestamp[19] !== "-" || timestamp[23] !== "Z") {
    return false;
  }
  const parsedTimestamp = `${timestamp.slice(0, 13)}:${timestamp.slice(14, 16)}:${timestamp.slice(17, 19)}.${timestamp.slice(20)}`;
  if (Number.isNaN(Date.parse(parsedTimestamp))) {
    return false;
  }
  const collisionSuffix = suffix.slice(24);
  if (collisionSuffix.length === 0) {
    return true;
  }
  if (collisionSuffix === ".missing") {
    return true;
  }
  return collisionSuffix[0] === "-" && collisionSuffix.slice(1).length > 0 && [...collisionSuffix.slice(1)].every((character) => character >= "0" && character <= "9");
}

// ============================================================================
// Config Mutation Handlers
// ============================================================================

async function applyConfigMerge(
  mutation: Extract<Mutation, { kind: "configMerge" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  const formatName = mutation.format ?? detectFormat(rawPath);
  if (!formatName) {
    throw new Error(
      `Cannot detect config format for "${rawPath}". Provide explicit format option.`
    );
  }
  const format = getConfigFormat(formatName);

  const rawContent = await readFileIfExists(context.fs, targetPath);
  let preserveContent = rawContent;
  let current: ConfigObject;
  try {
    current = rawContent === null ? {} : format.parse(rawContent);
  } catch {
    // Invalid file - backup and start fresh
    if (rawContent !== null && !context.dryRun) {
      await backupInvalidDocument(context, targetPath, rawContent);
    }
    current = {};
    preserveContent = null;
  }

  const value = resolveValue(mutation.value, options);
  if (!isConfigObject(value)) {
    throw new Error(`configMerge value must be an object for "${rawPath}".`);
  }

  // Keep prefix pruning on the same proto-safe object-write path as normal merges.
  let merged: ConfigObject;
  if (mutation.pruneByPrefix) {
    merged = mergeWithPruneByPrefix(current, value, mutation.pruneByPrefix);
  } else {
    merged = format.merge(current, value);
  }

  const serialized = serializeConfigUpdate(format, preserveContent, current, merged);
  const changed = serialized !== rawContent;

  if (changed && !context.dryRun) {
    await writeAtomically(context, targetPath, serialized);
  }

  return {
    outcome: {
      changed,
      effect: changed ? "write" : "none",
      detail: changed ? (rawContent === null ? "create" : "update") : "noop"
    },
    details
  };
}

async function applyConfigPrune(
  mutation: Extract<Mutation, { kind: "configPrune" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  const rawContent = await readFileIfExists(context.fs, targetPath);
  if (rawContent === null) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  const formatName = mutation.format ?? detectFormat(rawPath);
  if (!formatName) {
    throw new Error(
      `Cannot detect config format for "${rawPath}". Provide explicit format option.`
    );
  }
  const format = getConfigFormat(formatName);

  let current: ConfigObject;
  try {
    current = format.parse(rawContent);
  } catch {
    // Invalid file - can't prune, leave as-is
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  // Check onlyIf guard
  if (mutation.onlyIf && !mutation.onlyIf(current, options)) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  const shape = resolveValue(mutation.shape, options);
  const { changed, result } = format.prune(current, shape);

  if (!changed) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  // Delete file if empty
  if (Object.keys(result).length === 0) {
    if (!context.dryRun) {
      await context.fs.unlink(targetPath);
    }
    return {
      outcome: { changed: true, effect: "delete", detail: "delete" },
      details
    };
  }

  const serialized = serializeConfigUpdate(format, rawContent, current, result);
  if (!context.dryRun) {
    await writeAtomically(context, targetPath, serialized);
  }

  return {
    outcome: { changed: true, effect: "write", detail: "update" },
    details
  };
}

async function applyConfigTransform(
  mutation: Extract<Mutation, { kind: "configTransform" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  const formatName = mutation.format ?? detectFormat(rawPath);
  if (!formatName) {
    throw new Error(
      `Cannot detect config format for "${rawPath}". Provide explicit format option.`
    );
  }
  const format = getConfigFormat(formatName);

  const rawContent = await readFileIfExists(context.fs, targetPath);
  let preserveContent = rawContent;
  let current: ConfigObject;
  try {
    current = rawContent === null ? {} : format.parse(rawContent);
  } catch {
    if (rawContent !== null && !context.dryRun) {
      await backupInvalidDocument(context, targetPath, rawContent);
    }
    current = {};
    preserveContent = null;
  }

  const { content: transformed, changed } = mutation.transform(current, options);

  if (!changed) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  // Delete file if null
  if (transformed === null) {
    if (rawContent === null) {
      return {
        outcome: { changed: false, effect: "none", detail: "noop" },
        details
      };
    }
    if (!context.dryRun) {
      await context.fs.unlink(targetPath);
    }
    return {
      outcome: { changed: true, effect: "delete", detail: "delete" },
      details
    };
  }

  const serialized = serializeConfigUpdate(format, preserveContent, current, transformed);
  const serializedChanged = serialized !== rawContent;
  if (!serializedChanged) {
    return {
      outcome: { changed: false, effect: "none", detail: "noop" },
      details
    };
  }

  if (!context.dryRun) {
    await writeAtomically(context, targetPath, serialized);
  }

  return {
    outcome: {
      changed: true,
      effect: "write",
      detail: rawContent === null ? "create" : "update"
    },
    details
  };
}

// ============================================================================
// Template Mutation Handlers
// ============================================================================

async function applyTemplateWrite(
  mutation: Extract<Mutation, { kind: "templateWrite" }>,
  context: MutationContext,
  options: MutationOptions
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  if (!context.templates) {
    throw new Error(
      "Template mutations require a templates loader. " +
        "Provide templates function to runMutations context."
    );
  }

  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  const template = await context.templates(mutation.templateId);
  const templateContext = mutation.context
    ? resolveValue(mutation.context, options)
    : {};
  const rendered = renderTemplate(template, templateContext);

  const current = await readFileIfExists(context.fs, targetPath);
  const changed = current !== rendered;

  if (changed && !context.dryRun) {
    await writeAtomically(context, targetPath, rendered);
  }

  return {
    outcome: {
      changed,
      effect: changed ? "write" : "none",
      detail: changed ? (current === null ? "create" : "update") : "noop"
    },
    details
  };
}

async function applyTemplateMerge(
  mutation: Extract<Mutation, { kind: "templateMergeToml" | "templateMergeJson" }>,
  context: MutationContext,
  options: MutationOptions,
  formatName: "toml" | "json"
): Promise<{ outcome: MutationOutcome; details: MutationDetails }> {
  if (!context.templates) {
    throw new Error(
      "Template mutations require a templates loader. " +
        "Provide templates function to runMutations context."
    );
  }

  const rawPath = resolveValue(mutation.target, options);
  const targetPath = resolvePath(rawPath, context.homeDir, context.pathMapper);

  const details: MutationDetails = {
    kind: mutation.kind,
    label: mutation.label ?? describeMutation(mutation.kind, targetPath),
    targetPath
  };

  const format = getConfigFormat(formatName);

  // Load and render template
  const template = await context.templates(mutation.templateId);
  const templateContext = mutation.context
    ? resolveValue(mutation.context, options)
    : {};
  const rendered = renderTemplate(template, templateContext);

  // Parse rendered template
  let templateDoc: ConfigObject;
  try {
    templateDoc = format.parse(rendered);
  } catch (error) {
    throw new Error(
      `Failed to parse rendered template "${mutation.templateId}" as ${formatName.toUpperCase()}: ${error}`,
      { cause: error }
    );
  }

  // Read and parse existing file
  const rawContent = await readFileIfExists(context.fs, targetPath);
  let current: ConfigObject;
  try {
    current = rawContent === null ? {} : format.parse(rawContent);
  } catch {
    if (rawContent !== null && !context.dryRun) {
      await backupInvalidDocument(context, targetPath, rawContent);
    }
    current = {};
  }

  // Merge
  const merged = format.merge(current, templateDoc);
  const serialized = format.serialize(merged);
  const changed = serialized !== rawContent;

  if (changed && !context.dryRun) {
    await writeAtomically(context, targetPath, serialized);
  }

  return {
    outcome: {
      changed,
      effect: changed ? "write" : "none",
      detail: changed ? (rawContent === null ? "create" : "update") : "noop"
    },
    details
  };
}
