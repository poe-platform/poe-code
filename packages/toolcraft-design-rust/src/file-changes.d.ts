export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";
export type FileChangeDisplayMode = "status" | "diff";
export type FileChangeOutputFormat = "terminal" | "markdown";
export interface FileChange {
  path: string;
  kind: FileChangeKind;
  oldPath?: string;
  conflict?: boolean;
  oldContent?: string;
  newContent?: string;
}
export interface RenderFileChangesOptions {
  mode?: FileChangeDisplayMode;
  format?: FileChangeOutputFormat;
}
export declare function renderFileChanges(changes: readonly FileChange[], options?: RenderFileChangesOptions): string;
