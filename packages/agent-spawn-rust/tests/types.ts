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
