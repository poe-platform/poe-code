import type { FileChange, FileChangeDisplayMode } from "toolcraft-design-rust";
import type { Renderers } from "./definitions.js";

export interface FileChangeResult {
  changes: readonly FileChange[];
}
export interface FileChangeRendererOptions {
  mode?: FileChangeDisplayMode;
}
export declare function createFileChangeRenderers<TResult extends FileChangeResult = FileChangeResult>(
  options?: FileChangeRendererOptions
): Renderers<TResult>;
