import type { CommandContext, CommandDefinition, CommandResult, RegisterCommandOptions } from "safe-bash-contracts/command";
import type { FileSystem, ShellSessionState, ShellSessionHooks, ShellExecOptions } from "@poe-platform/safe-bash";

export interface RustWasmFileInit {
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly mtime?: Date;
}

export interface RustWasmBashOptions {
  readonly hooks?: ShellSessionHooks;
  readonly onInternalError?: ShellExecOptions["onInternalError"];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly directories?: readonly string[];
  readonly files?: Readonly<Record<string, string | Uint8Array | RustWasmFileInit>>;
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly limits?: Readonly<Record<string, number | undefined>> | object;
  readonly memoryFsOptions?: Readonly<Record<string, unknown>>;
  readonly forceNative?: boolean;
  readonly deviceView?: "default" | "provided";
  readonly companionFactory?: () => { shell: unknown; fs: unknown };
  readonly companionSeed?: (fs: unknown) => Promise<void>;
  readonly profile?: "warm-memory-fastpath" | "overlay-cow-fs" | "strict-budgets-mount-dev";
  readonly ShellLimitError?: unknown;
}

type RustWasmFileSystem = WasmFileSystem | FileSystem;
export type RustWasmExecOptions = Omit<ShellExecOptions, "fs"> & { readonly fs?: RustWasmFileSystem };

export interface RustWasmExecResult {
  readonly state?: ShellSessionState;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: Uint8Array;
  readonly stderrBytes: Uint8Array;
  readonly exitCode: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface WasmFileStat {
  readonly revision?: number;
  readonly uid?: number;
  readonly gid?: number;
  readonly allocatedBytes?: number;
  readonly ioBlockSize?: number;
  readonly preferredIoBlockSize?: number;
  readonly filesystemType?: string;
  readonly dev?: number;
  readonly ino?: number;
  readonly nlink?: number;
  readonly identityScope?: symbol;
  readonly type: "file" | "directory" | "symlink" | "character";
  readonly size: number;
  readonly mode: number;
  readonly mtime: Date;
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs?: number;
  readonly birthtimeMs?: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

export interface WasmFileDescriptor {
  readonly capabilities: {
    readonly positionedRead: boolean; readonly positionedWrite: boolean; readonly truncate: boolean;
    readonly position: true; readonly synchronization: "volatile" | "none"; readonly noFollow?: boolean;
    readonly readObservation?: boolean; readonly openTruncate?: boolean;
    readonly positionedAppendWrite?: boolean; readonly delegateZeroLengthWrite?: boolean;
  };
  stat(options?: {signal?: AbortSignal}): Promise<WasmFileStat>;
  getPosition(options?: {signal?: AbortSignal}): Promise<number>;
  probeRead(options?: {signal?: AbortSignal}): Promise<"ready" | "blocked" | "unknown">;
  read(buffer: Uint8Array, position: number | null, options?: {signal?: AbortSignal}): Promise<number>;
  write(buffer: Uint8Array, position: number | null, options?: {signal?: AbortSignal}): Promise<number>;
  truncate(length: number, options?: {signal?: AbortSignal}): Promise<void>;
  sync(dataOnly: boolean, options?: {signal?: AbortSignal}): Promise<void>;
  close(options?: {signal?: AbortSignal}): Promise<void>;
}

export class WasmFileSystem {
  constructor(bash: RustWasmBash);
  readonly capabilities: Readonly<Record<string, boolean | undefined>>;
  access(path: string, mode?: number, options?: { signal?: AbortSignal }): Promise<void>;
  readFile(filePath: string, options?: { maxBytes?: number; signal?: AbortSignal }): Promise<Uint8Array>;
  writeFile(filePath: string, data: string | Uint8Array, options?: { flag?: "w" | "wx" | "a" | "ax"; mode?: number; signal?: AbortSignal }): Promise<void>;
  appendFile(filePath: string, data: string | Uint8Array, options?: { mode?: number; signal?: AbortSignal }): Promise<void>;
  mkdir(dirPath: string, options?: { recursive?: boolean; mode?: number; exactMode?: boolean; signal?: AbortSignal }): Promise<void>;
  readdir(dirPath: string, options?: { maxEntries?: number; signal?: AbortSignal }): Promise<{name: string; type: WasmFileStat["type"]}[]>;
  stat(filePath: string, options?: { signal?: AbortSignal }): Promise<WasmFileStat>;
  lstat(filePath: string, options?: { signal?: AbortSignal }): Promise<WasmFileStat>;
  symlink(target: string, linkPath: string, options?: { signal?: AbortSignal }): Promise<void>;
  readlink(linkPath: string, options?: { signal?: AbortSignal }): Promise<string>;
  chmod(filePath: string, mode: number, options?: { signal?: AbortSignal; parent?: WasmFileStat; expected?: WasmFileStat; ancestors?: readonly { path: string; stat: WasmFileStat }[]; commitGuard?: () => true }): Promise<void>;
  unlink(filePath: string, options?: { signal?: AbortSignal }): Promise<void>;
  rm(filePath: string, options?: { recursive?: boolean; force?: boolean; signal?: AbortSignal }): Promise<void>;
  rmdir(dirPath: string, options?: { signal?: AbortSignal }): Promise<void>;
  utimes(filePath: string, atime: Date | number, mtime: Date | number, options?: { signal?: AbortSignal }): Promise<void>;
  realpath(filePath: string, options?: { signal?: AbortSignal }): Promise<string>;
  openReadFile(filePath: string, options?: { signal?: AbortSignal; allowDirectory?: boolean }): Promise<{
    stat(options?: {signal?: AbortSignal}): Promise<WasmFileStat>;
    read(position: number, maximum: number, options?: {signal?: AbortSignal}): Promise<Uint8Array>;
    seekEnd(options?: {signal?: AbortSignal}): Promise<bigint>;
    close(): Promise<void>;
  }>;
  open(filePath: string, options: {
    access: "read" | "write" | "readwrite"; creation?: "never" | "ifMissing" | "exclusive";
    truncate?: boolean; append?: boolean; mode?: number; exactMode?: boolean; noFollow?: boolean;
    synchronization?: "data" | "all"; signal?: AbortSignal;
  }): Promise<WasmFileDescriptor>;
  link(oldPath: string, newPath: string, options?: { signal?: AbortSignal }): Promise<void>;
  rename(oldPath: string, newPath: string, options?: { noReplace?: boolean; signal?: AbortSignal }): Promise<void>;
  copyFile(srcPath: string, destPath: string, options?: { exclusive?: boolean; signal?: AbortSignal }): Promise<void>;
  statfs(targetPath?: string): Promise<Record<string, number>>;
}

type StreamCommandContext = Pick<CommandContext, "command" | "argv0" | "args" | "argumentValues" | "cwd" | "env" | "stdin" | "stdinIsDefault" | "stdout" | "stderr" | "signal" | "capabilities" | "onInternalError"> & {readonly registerCleanup: NonNullable<CommandContext["registerCleanup"]>; readonly fs: Pick<WasmFileSystem, "readFile" | "writeFile" | "appendFile" | "stat" | "lstat" | "readdir" | "mkdir" | "rm" | "capabilities" | "access" | "chmod" | "readlink" | "realpath">};
type StreamCommand = Omit<CommandDefinition, "execute"> & {
  readonly execute: (context: StreamCommandContext) => CommandResult | Promise<CommandResult>;
};

interface StreamCommandRegistry {
  register(command: StreamCommand, options?: RegisterCommandOptions): this;
  get(name: string): StreamCommand | undefined;
  has(name: string): boolean;
  unregister(name: string): boolean;
  list(): readonly StreamCommand[];
}

export class RustWasmBash {
  readonly shell: RustWasmBash;
  readonly fs: WasmFileSystem;
  readonly forceNative: boolean;
  readonly state: {
    cwd: string;
    env: Record<string, string>;
    vars: Record<string, string>;
    functions: Record<string, string>;
  };

  constructor(options?: RustWasmBashOptions);
  register(command: StreamCommand, options?: RegisterCommandOptions): this;
  use(plugin: {
    readonly name?: string;
    setup(host: {commands: StreamCommandRegistry; registerFileSystem: RustWasmBash["registerFileSystem"]}): void | Promise<void>;
    dispose?(): void | Promise<void>;
  }): this;
  mountDevices(): void;
  mkdirAll(dirPath: string): void;
  writeFile(filePath: string, data: string | Uint8Array): void;
  readFile(filePath: string, options?: { maxBytes?: number; signal?: AbortSignal }): Uint8Array;
  readText(filePath: string): string;
  removePath(filePath: string): void;
  symlink(target: string, linkPath: string): void;
  readlink(linkPath: string): string;
  chmod(filePath: string, mode: number): void;
  setMtime(filePath: string, mtime: Date | number): void;
  setLimits(limits: Readonly<Record<string, number | undefined>> | object): void;
  stat(filePath: string, follow?: boolean): WasmFileStat;
  readdir(dirPath: string): string[];
  setEnv(key: string, value: string): void;
  execSync(script: string, stdin?: string | Uint8Array): RustWasmExecResult;
  exec(script: string, options?: RustWasmExecOptions): Promise<RustWasmExecResult>;
  registerFileSystem(scheme: string, factory: (options: Readonly<Record<string, unknown>>) => RustWasmFileSystem | Promise<RustWasmFileSystem>): void;
  createFileSystem(scheme: string, options?: Readonly<Record<string, unknown>>): Promise<RustWasmFileSystem>;
  createSession(initialState?: ShellSessionState): {
    state: ShellSessionState | undefined;
    exec(script: string, options?: RustWasmExecOptions): Promise<RustWasmExecResult>;
    dispose(): Promise<void>;
  };
  dispose(): void | Promise<void>;
}

export function createRustWasmBash(options?: RustWasmBashOptions): RustWasmBash;
