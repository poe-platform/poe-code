export interface RustWasmFileInit {
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly mtime?: Date;
}

export interface RustWasmBashOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly directories?: readonly string[];
  readonly files?: Readonly<Record<string, string | Uint8Array | RustWasmFileInit>>;
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly limits?: Readonly<Record<string, number | undefined>> | object;
  readonly memoryFsOptions?: Readonly<Record<string, unknown>>;
  readonly forceNative?: boolean;
  readonly companionFactory?: () => { shell: unknown; fs: unknown };
  readonly companionSeed?: (fs: unknown) => Promise<void>;
  readonly profile?: "warm-memory-fastpath" | "overlay-cow-fs" | "strict-budgets-mount-dev";
  readonly ShellLimitError?: unknown;
}

export interface RustWasmExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: Uint8Array;
  readonly stderrBytes: Uint8Array;
  readonly exitCode: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface WasmFileStat {
  readonly type: "file" | "directory" | "symlink";
  readonly size: number;
  readonly mode: number;
  readonly mtime: Date;
  readonly mtimeMs: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

export class WasmFileSystem {
  constructor(bash: RustWasmBash);
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, data: string | Uint8Array): Promise<void>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(dirPath: string): Promise<string[]>;
  stat(filePath: string): Promise<WasmFileStat>;
  lstat(filePath: string): Promise<WasmFileStat>;
  symlink(target: string, linkPath: string): Promise<void>;
  readlink(linkPath: string): Promise<string>;
  chmod(filePath: string, mode: number): Promise<void>;
  unlink(filePath: string): Promise<void>;
  rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rmdir(dirPath: string): Promise<void>;
  utimes(filePath: string, atime: Date | number, mtime: Date | number): Promise<void>;
  realpath(filePath: string): Promise<string>;
  open(filePath: string, flags?: string | number, mode?: number): Promise<unknown>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(srcPath: string, destPath: string): Promise<void>;
  statfs(targetPath?: string): Promise<Record<string, number>>;
}

export class RustWasmBash {
  readonly shell: RustWasmBash;
  readonly fs: WasmFileSystem;
  readonly state: {
    cwd: string;
    env: Record<string, string>;
    vars: Record<string, string>;
    functions: Record<string, string>;
  };

  constructor(options?: RustWasmBashOptions);
  mkdirAll(dirPath: string): void;
  writeFile(filePath: string, data: string | Uint8Array): void;
  readFile(filePath: string): Uint8Array;
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
  exec(script: string, options?: { stdin?: string | Uint8Array; env?: Record<string, string> }): Promise<RustWasmExecResult>;
  createSession(initialState?: { rawHistory?: readonly string[] }): {
    readonly state: {
      cwd: string;
      env: Record<string, string>;
      vars: Record<string, string>;
      functions: Record<string, string>;
      rawHistory: string[];
    };
    exec(script: string, options?: { stdin?: string | Uint8Array }): Promise<RustWasmExecResult>;
  };
  dispose(): void;
}

export function createRustWasmBash(options?: RustWasmBashOptions): RustWasmBash;
