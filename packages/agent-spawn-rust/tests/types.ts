import * as own from "../dist/index.js";
import type * as original from "@poe-code/agent-spawn";
type Planning = Pick<
  typeof original,
  | "SPAWN_MODES"
  | "DEFAULT_SPAWN_MODE"
  | "resolveModeConfig"
  | "resolveAgentModeConfig"
  | "getSpawnConfig"
  | "getAcpSpawnConfig"
  | "allSpawnConfigs"
  | "supportsSpawnMode"
  | "supportsMcpAtSpawn"
  | "listMcpSupportedAgents"
  | "listSpawnableAgents"
  | "resolveSpawnableAgent"
  | "buildSpawnArgs"
  | "mergeSpawnEnvironment"
  | "serializeGooseMcpArgs"
  | "serializeOpenCodeMcpEnv"
  | "toJsonMcpServers"
>;
const a: Planning = own;
const b: Pick<typeof own, keyof Planning> = null as unknown as Planning;
void [a, b];
type Retry = Pick<
  typeof original,
  "createSpawnRetry" | "calculateBackoffMs" | "defaultIsRetryable"
>;
const c: Retry = own;
const d: Pick<typeof own, keyof Retry> = null as unknown as Retry;
void [c, d];

type Parallel = Pick<typeof original, "createSpawnParallel" | "SpawnParallelError">;
const e: Parallel = own;
const f: Pick<typeof own, keyof Parallel> = null as unknown as Parallel;
void [e, f];

type Command = Pick<typeof original, "runCommand">;
const g: Command = own;
const h: Pick<typeof own, keyof Command> = null as unknown as Command;
void [g, h];

type Adapters = Pick<typeof original, "adaptClaude" | "adaptCodex" | "adaptNative" | "getAdapter">;
const i: Adapters = own;
const j: Pick<typeof own, keyof Adapters> = null as unknown as Adapters;
void [i, j];

type Stream = Pick<typeof original, "readLines" | "applyMiddlewares">;
const k: Stream = own;
const l: Pick<typeof own, keyof Stream> = null as unknown as Stream;
void [k, l];

type Render = Pick<typeof original, "createToolRenderState" | "sessionUpdateToEvents">;
const m: Render = own;
const n: Pick<typeof own, keyof Render> = null as unknown as Render;
void [m, n];

type Otel = Pick<typeof original, "startNativeOtelCapture">;
const otelOriginal: Otel = own;
const otelOwn: Pick<typeof own, keyof Otel> = null as unknown as Otel;
void [otelOriginal, otelOwn];

import type { resolvePoeCommandExecution } from "../../agent-harness-tools/dist/poe-command-execution.js";
const resolveOriginal: typeof resolvePoeCommandExecution = own.resolveSpawnExecution;
const resolveOwn: typeof own.resolveSpawnExecution =
  null as unknown as typeof resolvePoeCommandExecution;
void [resolveOriginal, resolveOwn];

import type * as OriginalResources from "../../agent-spawn/dist/skill-bridge.js";
type Resources = Pick<typeof OriginalResources, "bridgeResourcesForRun" | "cleanupResourcesForRun">;
const resourcesOriginal: Resources = own;
const resourcesOwn: Pick<typeof own, keyof Resources> = null as unknown as Resources;
void [resourcesOriginal, resourcesOwn];

type ExecutionOptions = original.SpawnOptions;
const executionOptionsA: own.SpawnOptions = null as unknown as ExecutionOptions;
const executionOptionsB: ExecutionOptions = null as unknown as own.SpawnOptions;
const executionResultA: own.SpawnResult = null as unknown as original.SpawnResult;
const executionResultB: original.SpawnResult = null as unknown as own.SpawnResult;
const executionContextA: own.SpawnContext = null as unknown as original.SpawnContext;
const executionContextB: original.SpawnContext = null as unknown as own.SpawnContext;
const spawnSignatureA: (
  agentId: string,
  options: original.SpawnOptions,
  context?: original.SpawnContext
) => Promise<original.SpawnResult> = own.spawn;
const spawnSignatureB: typeof own.spawn = null as unknown as typeof original.spawn;
void [
  executionOptionsA,
  executionOptionsB,
  executionResultA,
  executionResultB,
  executionContextA,
  executionContextB,
  spawnSignatureA,
  spawnSignatureB
];
