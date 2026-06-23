export type PlanKind =
  | "plan"
  | "pipeline"
  | "experiment"
  | "ralph"
  | "superintendent"
  | "superintendent-base";

export type PlanFormat = "markdown" | "yaml";

export interface SavedForLaterMetadata {
  reason?: string;
}

export interface PlanEntry {
  path: string;
  absolutePath: string;
  kind: PlanKind;
  typeLabel: string;
  runner?: "pipeline" | "experiment" | "ralph" | "superintendent";
  detail: string;
  format: PlanFormat;
  title: string;
  updatedAt: number;
  schemaUrl?: string;
  savedForLater?: SavedForLaterMetadata;
}

export interface DiscoveryFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile?(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory?(): boolean; mtimeMs: number }>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename?(fromPath: string, toPath: string): Promise<void>;
  unlink?(path: string): Promise<void>;
}

export interface ActionFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  rmdir(path: string): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
}
