export { admitNativePromiseProperties } from "./interp/native-promise-properties.js";
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
