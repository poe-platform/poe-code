import type { CommandHandler, FileSystem } from "./index.js";
import { addAbortSignalWaiter, removeAbortSignalWaiter } from "./signals.js";
export { abortManagedController, addAbortSignalWaiter, combineManagedSignals, createManagedControlController, isManagedAbortSignal, isManagedControlSignal, notifyAbortSignalWaiters, registerManagedAbortSignal, removeAbortSignalWaiter, toNativeAbortSignal, type ManagedControlController, type AbortSignalWaiter } from "./signals.js";

/** Default command handlers eligible for the shell's built-in execution paths. */
export const builtInDirectContextExecutors = new WeakSet<CommandHandler>();

type SyncCsvEvaluator = (input: Uint8Array | undefined, args: readonly string[], readFile?: (path: string) => Uint8Array | undefined) => string | undefined;

export interface SyncCommandEvaluators {
  evalSyncCsvlook?: SyncCsvEvaluator;
  evalSyncCsvjson?: SyncCsvEvaluator;
  evalSyncCsvsort?: SyncCsvEvaluator;
  evalSyncCsvformat?: SyncCsvEvaluator;
  evalSyncCsvstat?: SyncCsvEvaluator;
  evalSyncIn2csv?: SyncCsvEvaluator;
  evalSyncCsvstack?: SyncCsvEvaluator;
  evalSyncCsvjoin?: SyncCsvEvaluator;

  evalSyncOpenssl?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSqlite3?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncGpg?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSsh?: (opArgs: readonly string[]) => string | undefined;
  evalSyncSshKeygen?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean, cwd?: string) => string | undefined;
  evalSyncPdfinfo?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncPdffonts?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncPdfdetach?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftotext?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftohtml?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncExiftool?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncQpdf?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftk?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSips?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncIdentify?: (cmdName: string, inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdfimages?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncFfmpeg?: (inBytes: Uint8Array | readonly string[] | undefined, opArgs?: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncFfprobe?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncGh?: (execute: any, opArgs: readonly string[], env: Readonly<Record<string, string>>, cwd?: string, readFileSync?: (path: string) => Uint8Array | undefined) => string | undefined;
  evalSyncPdftoppm?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPdftocairo?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncMmdc?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncPandoc?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSoffice?: (opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncSsconvert?: (execute: CommandHandler, opArgs: readonly string[], inBytes?: Uint8Array, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncWkhtmltopdf?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncOp?: (execute: any, opArgs: readonly string[], env: Readonly<Record<string, string>>) => string | undefined;
  evalSyncGit?: (stdinBytes: Uint8Array | undefined, opArgs: readonly string[], cwd: string, inspectNode?: any, readFile?: any, executeFn?: any, writeFileSync?: (path: string, bytes: Uint8Array, mode?: number) => boolean, mkdirSync?: (path: string) => boolean, rmSync?: (path: string) => boolean) => string | undefined;
  evalSyncTimeout?: (opArgs: readonly string[]) => string | undefined;
  evalSyncSplit?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncCsplit?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncCurl?: (opArgs: readonly string[]) => string | undefined;
  evalSyncWget?: (opArgs: readonly string[]) => string | undefined;
  evalSyncSponge?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncTruncate?: (opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean) => string | undefined;
  evalSyncInstall?: (opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, mode?: number) => boolean, statTypeSync?: (filePath: string) => string | undefined, mkdirSync?: (filePath: string, mode?: number) => boolean) => string | undefined;
  evalSyncApplyPatch?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean, removeFileSync?: (filePath: string) => boolean, mkdirSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncMktemp?: (opArgs: readonly string[], env: Readonly<Record<string, string>>, statTypeSync?: (filePath: string) => string | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean, mkdirSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncTee?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean) => string | undefined;
  evalSyncTouch?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean, utimesNodeSync?: (filePath: string, update: (stat: { atimeMs: number; mtimeMs: number }) => { atimeMs?: number; mtimeMs?: number }) => boolean, tz?: string) => string | undefined;
  evalSyncCp?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean, mode?: number) => boolean, statModeSync?: (filePath: string) => number | undefined, umask?: number) => string | undefined;
  evalSyncMv?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean, mode?: number) => boolean, rmSync?: (filePath: string) => boolean, statModeSync?: (filePath: string) => number | undefined) => string | undefined;
  evalSyncRmdir?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, listDirSync?: (filePath: string) => readonly string[] | ReadonlyMap<string, unknown> | undefined, rmSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncSleep?: (opArgs: readonly string[]) => string | undefined;
  evalSyncChmod?: (opArgs: readonly string[], umask: number, chmodNodeSync?: (filePath: string, change: (stat: { type: "file" | "directory" | "symlink"; mode: number }) => number) => boolean) => string | undefined;
  evalSyncPatch?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined, writeFileSync?: (filePath: string, bytes: Uint8Array, append: boolean) => boolean) => string | undefined;
  evalSyncMkdir?: (opArgs: readonly string[], umask: number, statTypeSync?: (filePath: string) => string | undefined, mkdirSync?: (filePath: string, recursive: boolean, mode: number) => boolean) => string | undefined;
  evalSyncRm?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, listDirSync?: (filePath: string) => readonly string[] | ReadonlyMap<string, unknown> | undefined, rmSync?: (filePath: string) => boolean) => string | undefined;
  evalSyncLn?: (opArgs: readonly string[], statTypeSync?: (filePath: string) => string | undefined, rmSync?: (filePath: string) => boolean, linkSync?: (srcOrTarget: string, dstPath: string, symbolic: boolean) => boolean) => string | undefined;
  evalSyncCat?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncHeadTail?: (name: "head" | "tail", inBytes: Uint8Array | undefined, opArgs: readonly string[], readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
  evalSyncWc?: (inBytes: Uint8Array | undefined, opArgs: readonly string[], singleByte: boolean, readFileSync?: (filePath: string) => Uint8Array | undefined) => string | undefined;
}

export const syncCommandEvaluators: SyncCommandEvaluators = {};


/** Creation mask carried through the shell's transparent filesystem views. */
export const creationUmask = Symbol("creationUmask");

const runtimeBackingFileSystems = new WeakMap<FileSystem, FileSystem>();

export function registerRuntimeBackingFileSystem(wrapper: FileSystem, backing: FileSystem): void {
  runtimeBackingFileSystems.set(wrapper, backing);
}

export function getRuntimeBackingFileSystem(fs: FileSystem): FileSystem | undefined {
  return runtimeBackingFileSystems.get(fs);
}

export function chargeRuntimeFileSystemOperation(fs: FileSystem): void {
  const backing = runtimeBackingFileSystems.get(fs) ?? fs;
  (backing as { _activeRuntimeBudget?: { fileSystemOperation(): void } })._activeRuntimeBudget?.fileSystemOperation();
}

const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

export function isSyncResolved(promise: unknown): promise is Promise<never> {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

function interruptibleSlow<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    addAbortSignalWaiter(signal, reject);
    promise.then(
      value => { removeAbortSignalWaiter(signal, reject); resolve(value); },
      error => { removeAbortSignalWaiter(signal, reject); reject(error); },
    );
  });
}

export function interruptible<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  if (isSyncResolved(promise)) return promise;
  return interruptibleSlow(promise, signal);
}
