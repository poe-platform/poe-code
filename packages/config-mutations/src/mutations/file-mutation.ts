import type {
  EnsureDirectoryMutation,
  RemoveFileMutation,
  ChmodMutation,
  BackupMutation,
  ValueResolver
} from "../types.js";

export interface EnsureDirectoryOptions {
  /** Directory path (must start with ~) */
  path: ValueResolver<string>;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface RemoveOptions {
  /** Target file path (must start with ~) */
  target: ValueResolver<string>;
  /** Only remove if file is empty/whitespace */
  whenEmpty?: boolean;
  /** Only remove if content matches regex */
  whenContentMatches?: RegExp;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface ChmodOptions {
  /** Target file path (must start with ~) */
  target: ValueResolver<string>;
  /** File permission mode (e.g., 0o755) */
  mode: number;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface BackupOptions {
  /** Target file path to backup (must start with ~) */
  target: ValueResolver<string>;
  /** Optional human-readable label for logging */
  label?: string;
}

function ensureDirectory(options: EnsureDirectoryOptions): EnsureDirectoryMutation {
  return {
    kind: "ensureDirectory",
    path: options.path,
    label: options.label
  };
}

function remove(options: RemoveOptions): RemoveFileMutation {
  return {
    kind: "removeFile",
    target: options.target,
    whenEmpty: options.whenEmpty,
    whenContentMatches: options.whenContentMatches,
    label: options.label
  };
}

function chmod(options: ChmodOptions): ChmodMutation {
  return {
    kind: "chmod",
    target: options.target,
    mode: options.mode,
    label: options.label
  };
}

function backup(options: BackupOptions): BackupMutation {
  return {
    kind: "backup",
    target: options.target,
    label: options.label
  };
}

export const fileMutation = {
  ensureDirectory,
  remove,
  chmod,
  backup
};
