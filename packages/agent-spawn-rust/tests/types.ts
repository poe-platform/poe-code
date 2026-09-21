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
