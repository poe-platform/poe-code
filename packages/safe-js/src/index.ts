import { parseModule as parseModuleInternal, type Module } from "./parse/parser.js";
import { restore as restoreInternal, type SafeJSSnapshot, type RestoreOptions } from "./restore.js";
import {
  deepCopyFromSandbox as copyFromSandboxInternal,
  type SandboxPromise,
  type SandboxValue
} from "./interp/values.js";

export { parse } from "./parse.js";
export const parseModule: (source: string, filename?: string) => Module = parseModuleInternal;
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
export { lint, type Diagnostic, type Fix, type LintFixResult, type LintOptions } from "./lint.js";
export { run } from "./run.js";
export { createRealm, type SafeJSRealm, type RealmOptions, type RealmResult, type RealmLimits } from "./realm.js";
export { defineExtension, type SafeJSExtension, type ExtensionDefinition, type ExtensionManifest, type ExtensionContext, type ExtensionExports, type CallbackOptions, type CallbackInvocation } from "./extensions.js";
export type { HostObject, HostObjectDefinition, HostObjectIndexedDefinition, HostObjectNamedDefinition, GuestReference } from "./interp/host-capabilities.js";
export { createReplayableRandom, type ReplayableRandom } from "./random.js";
export type { RunClock, RunClockSnapshot, RunRandom } from "./run.js";
export { noopOtelSink } from "./observability/otel.js";
export type { OtelSink, OtelSpan } from "./observability/otel.js";
export { FileSnapshotBackend } from "./snapshot/backend.js";
export type { Snapshot, SnapshotBackend } from "./snapshot/backend.js";
export { declareHostOperation } from "./interp/host-bridge.js";
export { HostCallResumabilityError } from "./interp/host-call.js";
export type {
  HostCallLifecycle,
  HostCallOutcome,
  HostCallRecord,
  HostCallResumeContext,
  HostCallResumeProof,
  HostCallResumeProvider,
  HostCallResumeRequest
} from "./interp/host-call.js";
export {
  HostOperationResumePolicyError,
  registerPendingHostCallPolicy
} from "./snapshot/policy.js";
export type {
  PendingHostCallPolicyMode,
  PendingHostCallPolicyRegistration
} from "./snapshot/policy.js";
export { dump, type DumpOptions } from "./dump.js";
export { inspectSnapshotMigration, migrateSnapshot } from "./migrate.js";
export { migrateSnapshotFile, type SnapshotMigrationFileOptions } from "./migration-file.js";
export type {
  SnapshotMigration,
  SnapshotMigrationOptions,
  SnapshotMigrationReconciliation,
  SnapshotMigrationResolution
} from "./migrate.js";
export { SnapshotValidationError } from "./snapshot/validation.js";
export type { SnapshotValidationCode } from "./snapshot/validation.js";
export { Budget, SandboxError } from "./interp/budget.js";
export type { BudgetName, BudgetOptions } from "./interp/budget.js";
export { formatInterpreterError, type InterpreterDiagnostic } from "./error/format.js";
export { deepCopyToSandbox } from "./interp/values.js";
export { runHarness, runHarnessPair } from "./runner/run-harness.js";
export { extractBlock } from "./loader/extract-block.js";
export { findExportedConstInitializer } from "./loader/find-exported.js";
export { splitFrontmatter } from "./loader/frontmatter.js";
export type { ExportDefaultDeclaration, ExportNamedDeclaration, MetaProperty } from "./parse.js";
export {
  AgentSpawnError,
  createSpawnUsageAccumulator,
  makeAgentModule,
  runWithSpawnUsageAccumulator
} from "./modules/agent.js";
export type {
  AgentModuleDefinition,
  AgentModuleOptions,
  AgentModuleParallelCall,
  AgentModuleRetryOptions,
  AgentModuleSpawnOptions,
  AgentSpawnEvent,
  SpawnAgent,
  SpawnAgentInput,
  SpawnAgentResult,
  SpawnUsageAccumulator,
  SpawnUsageTotal
} from "./modules/agent.js";
export { EnvAccessError, makeEnvModule, parseEnvConfig } from "./modules/env.js";
export type { EnvModule, EnvModuleOptions } from "./modules/env.js";
export { makeFailModule } from "./modules/fail.js";
export { makeFsModule } from "./modules/fs.js";
export { parseFsConfig, resolveFsConfig } from "./modules/fs-config.js";
export type { FsConfig, ResolveFsConfigOptions } from "./modules/fs-config.js";
export type {
  FsImplementation,
  FsModule,
  FsModuleOptions,
  SandboxDirent,
  SandboxStats
} from "./modules/fs.js";
export { makeHarnessModule } from "./modules/harness.js";
export { makeLogModule } from "./modules/log.js";
export { makeMetricModule } from "./modules/metric.js";
export { makeMcpModule } from "./modules/mcp.js";
export { parseMcpConfig } from "./modules/mcp-transport.js";
export type { McpModuleOptions, McpServerConfig } from "./modules/mcp-transport.js";
export type { ManagedMcpClient, ManagedMcpModule, McpNamedServerHandle } from "./modules/mcp.js";
export { makeTimeModule } from "./modules/time.js";
