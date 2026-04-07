export type PlanSource = "pipeline" | "experiment" | "ralph";

export type PlanFormat = "yaml" | "markdown";

export interface PlanEntry {
  path: string;
  absolutePath: string;
  source: PlanSource;
  format: PlanFormat;
  title: string;
  status: string;
  updatedAt: number;
}

export interface DiscoveryFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile?(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory?(): boolean; mtimeMs: number }>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename?(fromPath: string, toPath: string): Promise<void>;
  unlink?(path: string): Promise<void>;
}

export interface ActionFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
}
