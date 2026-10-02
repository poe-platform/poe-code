import { parseModule as parseModuleInternal, parseSourceModule as parseSourceModuleInternal, type Module, type ParsedSourceModule } from "./parse/parser.js";
import { restore as restoreInternal, type SafeJSSnapshot, type RestoreOptions } from "./restore.js";
import {
  deepCopyFromSandbox as copyFromSandboxInternal,
  type SandboxPromise,
  type SandboxValue
} from "./interp/values.js";

export { parse } from "./parse.js";
export const parseModule: (source: string, filename?: string) => Module = parseModuleInternal;
export const parseSourceModule: (source: string, filename?: string) => ParsedSourceModule = parseSourceModuleInternal;
export type { ParsedSourceModule, SourceImport, SourceExport } from "./parse/module-syntax.js";
export const restore: <TSnapshot extends SafeJSSnapshot>(
  snapshot: TSnapshot,
  options: RestoreOptions
) => TSnapshot = restoreInternal;
type PublicCopyOptions = Omit<
  NonNullable<Parameters<typeof copyFromSandboxInternal>[1]>,
  "compilation" | "unwrapHostObject"
>;
export const deepCopyFromSandbox: {
  (value: SandboxPromise, options?: PublicCopyOptions): Promise<unknown>;
  (value: SandboxValue, options?: PublicCopyOptions): unknown;
} = copyFromSandboxInternal;
export { admitNativePromiseProperties } from "./interp/native-promise-properties.js";
export { captureHostContext } from "./host-context.js";
export { lint, type Diagnostic, type Fix, type LintFixResult, type LintOptions } from "./lint.js";
export { run } from "./run.js";
export type { RunPromise } from "./run.js";
export type { ExecutionControl } from "./interp/jobs.js";
export { createRealm, type SafeJSRealm, type RealmOptions, type RealmResult, type RealmLimits } from "./realm.js";
export { defineExtension, type SafeJSExtension, type ExtensionDefinition, type ExtensionManifest, type ExtensionContext, type HostConstructorOptions, type ExtensionExports, type CallbackOptions, type CallbackInvocation } from "./extensions.js";
export type { HostObject, HostObjectDefinition, HostObjectIndexedDefinition, HostObjectNamedDefinition, GuestReference } from "./interp/host-capabilities.js";
export { createReplayableRandom, type ReplayableRandom } from "./random.js";
export type { RunClock, RunClockSnapshot, RunRandom } from "./run.js";
export { Budget } from "./interp/budget.js";
export type { SnapshotValidationCode } from "./snapshot/validation.js";

export type {SourceResolver, SourceModule} from "./modules/source-graph.js";

export {createRootedSourceResolver} from "./modules/source-files.js";

export * from "./modules/env.js";
export * from "./modules/fail.js";
export * from "./modules/fs.js";
export * from "./modules/harness.js";
export * from "./modules/metric.js";
export * from "./modules/time.js";

export { makeLogModule, type LogModuleEntry, type LogModuleSink } from "./modules/log.js";

export { dump, type DumpOptions } from "./dump.js";
export { deepCopyToSandbox } from "./interp/values.js";
export { SandboxError } from "./interp/budget.js";
export { SnapshotValidationError } from "./snapshot/validation.js";
export { declareHostOperation } from "./interp/host-bridge.js";

export { parseFsConfig, resolveFsConfig } from "./modules/fs-config.js";
export type { FsConfig, ResolveFsConfigOptions } from "./modules/fs-config.js";
