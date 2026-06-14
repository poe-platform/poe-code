import path from "node:path";
import type { FileAwareness } from "./plugin-types.js";

export interface FileAwarenessTracker {
  recordRead(filePath: string): void;
  recordWrite(filePath: string): void;
  snapshot(): FileAwareness;
}

export function createFileAwarenessTracker(cwd: string): FileAwarenessTracker {
  const readFiles = new Set<string>();
  const modifiedFiles = new Set<string>();

  return {
    recordRead(filePath: string): void {
      readFiles.add(normalizePath(cwd, filePath));
    },

    recordWrite(filePath: string): void {
      modifiedFiles.add(normalizePath(cwd, filePath));
    },

    snapshot(): FileAwareness {
      return {
        readFiles: new Set(readFiles),
        modifiedFiles: new Set(modifiedFiles)
      };
    }
  };
}

export function recordToolFileAwareness(options: {
  tracker: FileAwarenessTracker;
  tool: string;
  args: unknown;
}): void {
  const filePath = getPathArg(options.args);
  if (!filePath) {
    return;
  }

  if (options.tool === "read_file") {
    options.tracker.recordRead(filePath);
    return;
  }

  if (options.tool === "write_file" || options.tool === "edit") {
    options.tracker.recordWrite(filePath);
  }
}

function getPathArg(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  const filePath = (args as { path?: unknown }).path;
  return typeof filePath === "string" && filePath.trim().length > 0 ? filePath : undefined;
}

function normalizePath(cwd: string, filePath: string): string {
  return path.resolve(cwd, filePath);
}
