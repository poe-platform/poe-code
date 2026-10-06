export interface RustWasmFileEntry {
  readonly content: string | Uint8Array;
  readonly mode?: number;
}

export type RustWasmFileInit = string | Uint8Array | RustWasmFileEntry;

export interface RustWasmBashOptions {
  readonly files?: Readonly<Record<string, RustWasmFileInit>>;
  readonly directories?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RustWasmExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface RustWasmSession {
  readonly state: Record<string, unknown>;
  exec(script: string, options?: { stdin?: string | Uint8Array }): Promise<RustWasmExecResult>;
}

export declare class RustWasmBash {
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
  setEnv(key: string, value: string): void;
  execSync(script: string, stdin?: string | Uint8Array): RustWasmExecResult;
  exec(script: string, options?: { stdin?: string | Uint8Array }): Promise<RustWasmExecResult>;
  createSession(initialState?: Record<string, unknown>): RustWasmSession;
  dispose(): void;
}

export declare function createRustWasmBash(options?: RustWasmBashOptions): RustWasmBash;
