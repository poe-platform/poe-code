import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import type { SourceHookEntry } from "./read-hooks.js";
import type { GeneratedHookEntry } from "./transform-hooks.js";

export interface WriteResult {
  path: string;
  fileCreated: boolean;
  previousGeneratedRemoved: number;
  generatedWritten: number;
}

interface CodexMatcherGroup {
  matcher?: string;
  hooks: SourceHookEntry["handler"][];
}

interface CodexHooksFile {
  hooks?: Record<string, CodexMatcherGroup[]>;
}

function validateHooksFile(file: CodexHooksFile, targetPath: string): void {
  for (const groups of Object.values(file.hooks ?? {})) {
    if (
      !Array.isArray(groups) ||
      groups.some(
        (group) =>
          typeof group !== "object" ||
          group === null ||
          Array.isArray(group) ||
          !Array.isArray(group.hooks)
      )
    ) {
      throw new Error(`Malformed hooks in ${targetPath}`);
    }
  }
}

function isGeneratedHandler(handler: SourceHookEntry["handler"], runId?: string): boolean {
  return handler.statusMessage?.startsWith(`[generated:poe-code:${runId ?? ""}`) ?? false;
}

function parseHooksFile(targetPath: string): { file: CodexHooksFile; fileCreated: boolean } {
  let content: string;

  try {
    content = readFileSync(targetPath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return { file: { hooks: {} }, fileCreated: true };
    }

    throw error;
  }

  let file: CodexHooksFile;
  try {
    file = JSON.parse(content) as CodexHooksFile;
  } catch (error) {
    throw new Error(`Malformed JSON in ${targetPath}`, { cause: error });
  }
  validateHooksFile(file, targetPath);
  return { file, fileCreated: false };
}

function validateEntries(entries: GeneratedHookEntry[], runId: string): void {
  for (const entry of entries) {
    if (!isGeneratedHandler(entry.handler, runId)) {
      throw new Error(
        `Generated hook entry "${entry.generatedId}" has statusMessage that must start with "[generated:poe-code:${runId}]"`
      );
    }
    if (entry.handler.timeout !== undefined && !Number.isFinite(entry.handler.timeout)) {
      throw new Error(`Generated hook entry "${entry.generatedId}" must have a finite timeout`);
    }
  }
}

function removeGeneratedHandlers(file: CodexHooksFile): number {
  let removed = 0;
  const hooks = file.hooks ?? (file.hooks = {});

  for (const [event, groups] of Object.entries(hooks)) {
    hooks[event] = groups.filter((group) => {
      const initialCount = group.hooks.length;
      const remainingHandlers = group.hooks.filter((handler) => {
        if (isGeneratedHandler(handler)) {
          removed += 1;
          return false;
        }

        return true;
      });

      group.hooks = remainingHandlers;
      return group.hooks.length > 0 || group.hooks.length === initialCount;
    });
  }

  return removed;
}

function appendEntries(file: CodexHooksFile, entries: GeneratedHookEntry[]): void {
  const hooks = file.hooks ?? (file.hooks = {});

  for (const entry of entries) {
    const groups = hooks[entry.event] ?? (hooks[entry.event] = []);
    let group = groups.find((candidate) => candidate.matcher === entry.matcher);

    if (!group) {
      group = entry.matcher === undefined ? { hooks: [] } : { matcher: entry.matcher, hooks: [] };
      groups.push(group);
    }

    group.hooks.push(entry.handler);
  }
}

export function writeCodexHooks(
  targetPath: string,
  entries: GeneratedHookEntry[],
  runId: string,
  opts?: { preserveGenerated?: boolean }
): WriteResult {
  const { file, fileCreated } = parseHooksFile(targetPath);
  validateEntries(entries, runId);
  const previousGeneratedRemoved = opts?.preserveGenerated ? 0 : removeGeneratedHandlers(file);
  appendEntries(file, entries);

  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = writeTemporaryFile(targetPath, runId, `${JSON.stringify(file, null, 2)}\n`);
  try {
    renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      void cleanupError;
    }
    throw error;
  }

  return {
    path: targetPath,
    fileCreated,
    previousGeneratedRemoved,
    generatedWritten: entries.length
  };
}

function writeTemporaryFile(targetPath: string, runId: string, content: string): string {
  for (let index = 0; ; index += 1) {
    const temporaryPath = `${targetPath}.tmp-${runId}-${index}`;
    try {
      writeFileSync(temporaryPath, content, { flag: "wx" });
      return temporaryPath;
    } catch (error) {
      if (!hasOwnErrorCode(error, "EEXIST")) {
        try {
          unlinkSync(temporaryPath);
        } catch (cleanupError) {
          void cleanupError;
        }
        throw error;
      }
    }
  }
}
