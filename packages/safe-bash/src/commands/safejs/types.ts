import type { FileSystem, NodeFsBridgeOptions } from "poe-code/safe-fs";

export type SafeJsHostFunction = { call(...args: readonly unknown[]): unknown }["call"];
export type SafeJsHostValue = string | number | boolean | null | undefined | SafeJsHostFunction
  | readonly SafeJsHostValue[] | { readonly [key: string]: SafeJsHostValue };
export type SafeJsModule = Record<string, SafeJsHostValue>;

export interface SafeJsBudgetOptions {
  readonly maxSteps: number;
  readonly deadline: number;
  readonly maxCallDepth: number;
  readonly stringLength: number;
  readonly arrayLength: number;
  readonly dataSize: number;
}

export interface SafeJsRunOptions<Budget> {
  readonly bindings?: SafeJsModule;
  readonly budget: Budget;
  readonly filename: string;
  readonly modules: Record<string, SafeJsModule>;
  readonly signal: AbortSignal;
  readonly sink: { log(...args: unknown[]): void; error(...args: unknown[]): void };
}

export type SafeJsRunResult = { readonly ok: true; readonly returnValue?: unknown }
  | { readonly ok: false; readonly error: unknown };

export interface SafeJsRuntime<Budget> {
  readonly run: (source: string, options: SafeJsRunOptions<Budget>) => Promise<SafeJsRunResult>;
  readonly createBudget: (options: SafeJsBudgetOptions) => Budget;
  readonly makeFsModule: (options: { adapter: FileSystem } & NodeFsBridgeOptions) => SafeJsModule;
  readonly declareHostOperation: <Operation extends SafeJsHostFunction>(operation: Operation, policy: "read-side-effect") => Operation;
}

export interface SafeJsCommandLimits {
  readonly maxSourceBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
  readonly maxSteps: number;
  readonly maxCallDepth: number;
  readonly stringLength: number;
  readonly arrayLength: number;
  readonly dataSize: number;
}

export interface SafeJsCommandsOptions<Budget = unknown> {
  readonly runtime?: SafeJsRuntime<Budget>;
  readonly limits?: Partial<SafeJsCommandLimits>;
  readonly replace?: boolean;
}

export class SafeJsCommandLimitError extends Error {
  readonly code = "SAFEJS_LIMIT";
  constructor(readonly resource: keyof SafeJsCommandLimits) {
    super(`SafeJS command limit exceeded: ${resource}`);
    this.name = "SafeJsCommandLimitError";
  }
}
