import type { FileSystem as SafeFileSystem } from "@poe-code/safe-fs/contracts";

export interface DataLayer {
  source: string;
  data: Record<string, unknown>;
}

export interface DocumentLayer {
  source: string;
  filePath: string;
  content: string;
  baseName?: string;
}

export interface BaseLayer {
  source: string;
  path: string;
}

export type ChainLayer = DataLayer | DocumentLayer | BaseLayer;

export interface FileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

export interface ResolveOptions {
  fs: FileSystem | Pick<SafeFileSystem, "capabilities" | "readFile">;
  autoExtend?: boolean;
  validate?: boolean;
  view?: Record<string, unknown>;
}

export interface ResolvedDocument {
  data: Record<string, unknown>;
  sources: Record<string, string>;
  chain: string[];
}

export interface ParsedDocument {
  data: Record<string, unknown>;
  format: "markdown" | "yaml" | "json";
  extends: boolean | string;
  hasExtendsField: boolean;
}
