import {
  renderFileChanges,
  type FileChange,
  type FileChangeDisplayMode
} from "toolcraft-design";
import type { Renderers } from "./index.js";

export interface FileChangeResult {
  changes: readonly FileChange[];
}

export interface FileChangeRendererOptions {
  mode?: FileChangeDisplayMode;
}

export function createFileChangeRenderers<TResult extends FileChangeResult = FileChangeResult>(
  options: FileChangeRendererOptions = {}
): Renderers<TResult> {
  return {
    rich: (result) => {
      process.stdout.write(`${renderFileChanges(result.changes, { mode: options.mode })}\n`);
    },
    markdown: (result) =>
      renderFileChanges(result.changes, { mode: options.mode, format: "markdown" }),
    json: (result) => result
  };
}
