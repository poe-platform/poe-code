import path from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { isPlanMetaDocument } from "./discovery.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { readSavedForLaterMetadata, writeSavedForLaterReason } from "./format.js";
import type { ActionFs, PlanFormat, SavedForLaterMetadata } from "./types.js";

const LATER_DIRECTORY = "later";

/**
 * Guessing an editor is how this hangs: `vi` inherits stdio and waits for keystrokes
 * that never arrive when nobody configured an editor. Demand an explicit one, like
 * `utils config edit` and `memory edit` already do.
 */
export function resolveEditor(env: Record<string, string | undefined> = process.env): string {
  const editor = getOwnEnvValue(env, "VISUAL")?.trim() || getOwnEnvValue(env, "EDITOR")?.trim();
  if (editor === undefined || editor.length === 0) {
    throw new Error("Set $EDITOR or $VISUAL to edit plans.");
  }
  return editor;
}

export function editFile(
  absolutePath: string,
  options: {
    env?: Record<string, string | undefined>;
    spawnSync?: typeof nodeSpawnSync;
  } = {}
): void {
  const [editor, ...editorArgs] = parseEditorCommand(resolveEditor(options.env));
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  const result = spawnSync(editor!, [...editorArgs, absolutePath], { stdio: "inherit" });
  if (result?.error !== undefined) {
    throw result.error;
  }
  if (result?.status !== undefined && result.status !== null && result.status !== 0) {
    throw new Error(`Editor exited with status ${result.status}.`);
  }
}

export async function editPlan(
  absolutePath: string,
  options: {
    env?: Record<string, string | undefined>;
    spawnSync?: typeof nodeSpawnSync;
    fs: Pick<ActionFs, "readFile">;
  }
): Promise<{ changed: boolean }> {
  const before = await readContent(absolutePath, options.fs);
  editFile(absolutePath, options);
  const after = await readContent(absolutePath, options.fs);
  return { changed: before !== after };
}

async function readContent(
  absolutePath: string,
  fs: Pick<ActionFs, "readFile">
): Promise<string | undefined> {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function archiveSelectedPlan(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: ActionFs
): Promise<string> {
  rejectPlanMetaDocument(entry.absolutePath, "archive");
  const archiveDir = path.join(path.dirname(entry.absolutePath), "archive");
  const archivedPath = path.join(archiveDir, path.basename(entry.absolutePath));
  try {
    await fs.readFile(archivedPath, "utf8");
    throw new Error(`Archive destination already exists: ${archivedPath}`);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  await rejectSymbolicLink(archiveDir, fs);
  const createdDirectory = await fs.mkdir(archiveDir, { recursive: true });
  try {
    await rejectSymbolicLink(archiveDir, fs);
    await fs.rename(entry.absolutePath, archivedPath);
  } catch (error) {
    if (createdDirectory !== undefined) {
      await fs.rmdir(archiveDir).catch(() => undefined);
    }
    throw error;
  }
  return archivedPath;
}

export async function savePlanForLater(
  entry: Pick<
    {
      absolutePath: string;
      format: PlanFormat;
      savedForLater?: SavedForLaterMetadata;
    },
    "absolutePath" | "format" | "savedForLater"
  >,
  fs: ActionFs,
  options: { reason?: string } = {}
): Promise<string> {
  const reason = entry.savedForLater?.reason?.trim() || options.reason?.trim();
  if (!reason) {
    throw new Error("Save-for-later reason is required.");
  }

  const laterDir = path.join(path.dirname(entry.absolutePath), LATER_DIRECTORY);
  const savedPath = path.join(laterDir, path.basename(entry.absolutePath));
  await rejectExistingDestination(savedPath, "Save-for-later", fs);
  await rejectSymbolicLink(laterDir, fs, "save plan for later through");

  const content = await fs.readFile(entry.absolutePath, "utf8");
  const currentMetadata = readSavedForLaterMetadata(content, entry.absolutePath);
  const nextContent = currentMetadata?.reason
    ? content
    : writeSavedForLaterReason(content, entry.absolutePath, reason);
  if (nextContent !== content) {
    await fs.writeFile(entry.absolutePath, nextContent, "utf8");
  }

  const createdDirectory = await fs.mkdir(laterDir, { recursive: true });
  try {
    await rejectSymbolicLink(laterDir, fs, "save plan for later through");
    await fs.rename(entry.absolutePath, savedPath);
  } catch (error) {
    if (createdDirectory !== undefined) {
      await fs.rmdir(laterDir).catch(() => undefined);
    }
    throw error;
  }

  return savedPath;
}

export async function restorePlanFromLater(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: ActionFs
): Promise<string> {
  const laterDir = path.dirname(entry.absolutePath);
  if (path.basename(laterDir) !== LATER_DIRECTORY) {
    throw new Error(`Plan is not saved for later: ${entry.absolutePath}`);
  }

  const restoredPath = path.join(path.dirname(laterDir), path.basename(entry.absolutePath));
  await rejectExistingDestination(restoredPath, "Restore", fs);
  await fs.rename(entry.absolutePath, restoredPath);
  return restoredPath;
}

async function rejectExistingDestination(
  destinationPath: string,
  label: string,
  fs: Pick<ActionFs, "readFile">
): Promise<void> {
  try {
    await fs.readFile(destinationPath, "utf8");
    throw new Error(`${label} destination already exists: ${destinationPath}`);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function rejectPlanMetaDocument(absolutePath: string, action: string): void {
  if (isPlanMetaDocument(absolutePath)) {
    throw new Error(`Refusing to ${action} plan directory README: ${absolutePath}`);
  }
}

async function rejectSymbolicLink(
  targetPath: string,
  fs: Pick<ActionFs, "lstat">,
  action = "archive plan through"
): Promise<void> {
  try {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      throw new Error(`Refusing to ${action} symbolic link: ${targetPath}`);
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

function getOwnEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

function isCommandWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function parseEditorCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let hasToken = false;

  for (const character of command) {
    if (escaping) {
      current += character;
      escaping = false;
      hasToken = true;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      hasToken = true;
      continue;
    }

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
        hasToken = true;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      hasToken = true;
      continue;
    }

    if (isCommandWhitespace(character)) {
      if (hasToken) {
        parts.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += character;
    hasToken = true;
  }

  if (escaping) {
    current += "\\";
  }

  if (hasToken) {
    parts.push(current);
  }

  return parts;
}

export { archiveSelectedPlan as archivePlan };

export async function deletePlan(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: Pick<ActionFs, "unlink">
): Promise<void> {
  rejectPlanMetaDocument(entry.absolutePath, "delete");
  await fs.unlink(entry.absolutePath);
}
