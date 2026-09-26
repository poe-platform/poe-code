export type WorkerMessage =
  | { kind: "call"; id: number; operation: string; args: unknown[]; signalScope?: number }
  | { kind: "cancel"; signalScope: number }
  | { kind: "release"; signalScope: number }
  | { kind: "reply"; id: number; value?: unknown; error?: { message: string; code?: string; path?: string; syscall?: string; dest?: string } }
  | { kind: "ready"; commands: readonly string[] }
  | { kind: "start" }
  | { kind: "signal"; number: number }
  | { kind: "result"; exitCode: number }
  | { kind: "failure"; message: string };

export interface WorkerModule {
  /** Explicit trusted module; arbitrary host closures cannot be moved into a worker. */
  readonly specifier: string;
  readonly exportName: string;
  readonly options?: unknown;
}
// The positional options slot is part of the FileSystem transport contract.
// Optional mode/length arguments must retain their slot when omitted.
export const filesystemOptionsIndex = {
  readFile: 1, writeFile: 2, appendFile: 2, stat: 1, lstat: 1,
  readdir: 1, mkdir: 1, rm: 1, rename: 2, copyFile: 2,
  realpath: 1, access: 2, unlink: 1, rmdir: 1, readlink: 1,
  symlink: 2, link: 2, chmod: 2, utimes: 3, truncate: 2,
} as const;
