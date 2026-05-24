import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
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

function isGeneratedHandler(handler: SourceHookEntry["handler"]): boolean {
  return handler.statusMessage?.startsWith("[generated:") ?? false;
}

function parseHooksFile(targetPath: string): { file: CodexHooksFile; fileCreated: boolean } {
  let content: string;

  try {
    content = readFileSync(targetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { file: { hooks: {} }, fileCreated: true };
    }

    throw error;
  }

  try {
    return { file: JSON.parse(content) as CodexHooksFile, fileCreated: false };
  } catch (error) {
    throw new Error(`Malformed JSON in ${targetPath}`, { cause: error });
  }
}

function validateEntries(entries: GeneratedHookEntry[]): void {
  for (const entry of entries) {
    if (!isGeneratedHandler(entry.handler)) {
      throw new Error(
        `Generated hook entry "${entry.generatedId}" has statusMessage that must start with "[generated:"`
      );
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
  _runId: string
): WriteResult {
  const { file, fileCreated } = parseHooksFile(targetPath);
  validateEntries(entries);
  const previousGeneratedRemoved = removeGeneratedHandlers(file);
  appendEntries(file, entries);

  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temporaryPath, targetPath);

  return {
    path: targetPath,
    fileCreated,
    previousGeneratedRemoved,
    generatedWritten: entries.length
  };
}
