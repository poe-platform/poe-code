import { native } from "./native.js";
export {
  SPAWN_MODES,
  DEFAULT_SPAWN_MODE,
  resolveModeConfig,
  resolveAgentModeConfig
} from "./types.js";
const planner = new native.NativeSpawnPlanner(),
  catalog = planner.catalog();
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function toJsonMcpServers(servers) {
  const mapped = native.spawnJsonServers(JSON.stringify(servers));
  for (const key of Object.keys(mapped)) {
    if (mapped[key].args) mapped[key].args = servers[key].args;
    if (mapped[key].env) mapped[key].env = servers[key].env;
  }
  return Object.assign(Object.create(null), mapped);
}
export function serializeGooseMcpArgs(servers) {
  return native.spawnMcp(JSON.stringify(servers), "goose");
}
export function serializeOpenCodeMcpEnv(servers) {
  return native.spawnMcp(JSON.stringify(servers), "opencode");
}
export function serializeCodexMcpArgs(servers) {
  return native.spawnMcp(JSON.stringify(servers), "codex");
}
export function serializeJsonMcpArgs(servers) {
  return native.spawnMcp(JSON.stringify(servers), "json");
}
function config(entry, descriptor, acp) {
  if (!descriptor) return undefined;
  const { order, mcp, modelTransforms, resume, argsRecipe, ...data } = descriptor,
    id = entry.metadata.id;
  const result = { ...data, agentId: id };
  if (mcp?.channel === "args")
    result.mcpArgs = (servers) => native.spawnMcp(JSON.stringify(servers), mcp.format);
  if (mcp?.channel === "env")
    result.mcpEnv = (servers) => native.spawnMcp(JSON.stringify(servers), mcp.format);
  if (mcp?.channel === "file")
    result.mcpFile = {
      relativePath: mcp.relativePath,
      content: (servers) => ({ mcpServers: toJsonMcpServers(servers) })
    };
  if (modelTransforms) result.modelTransform = (model) => planner.model(id, model);
  if (resume) {
    const { argsTemplate, hintArgsTemplate, ...data } = resume;
    result.resume = {
      ...data,
      args: (thread, cwd) => planner.resume(id, thread, cwd, false),
      ...(hintArgsTemplate
        ? { hintArgs: (thread, cwd) => planner.resume(id, thread, cwd, true) }
        : {})
    };
  }
  if (acp && argsRecipe) result.acpArgs = (options) => planner.acpArgs(id, JSON.stringify(options));
  return freeze(result);
}
const configs = new Map(),
  acpConfigs = new Map();
for (const entry of catalog) {
  if (entry.spawnConfig) configs.set(entry.metadata.id, config(entry, entry.spawnConfig, false));
  if (entry.acpSpawnConfig)
    acpConfigs.set(entry.metadata.id, config(entry, entry.acpSpawnConfig, true));
}
export const allSpawnConfigs = freeze(
  catalog
    .filter((entry) => entry.spawnConfig)
    .sort((a, b) => (a.spawnConfig.order ?? Infinity) - (b.spawnConfig.order ?? Infinity))
    .map((entry) => configs.get(entry.metadata.id))
);
export function getSpawnConfig(input) {
  return configs.get(planner.resolveId(input));
}
export function getAcpSpawnConfig(input) {
  return acpConfigs.get(planner.resolveId(input));
}
export const listMcpSupportedAgents = planner.supportedMcp.bind(planner);
export function supportsMcpAtSpawn(input) {
  return planner.supportedMcp().includes(planner.resolveId(input));
}
export const supportsSpawnMode = planner.supportsMode.bind(planner);
function spawnable(entry) {
  const metadata = entry.metadata,
    config = configs.get(metadata.id),
    acpConfig = acpConfigs.get(metadata.id);
  if (!config && !acpConfig) return undefined;
  return {
    id: metadata.id,
    name: metadata.name,
    label: metadata.label,
    summary: metadata.summary,
    aliases: [...(metadata.aliases ?? [])],
    ...(metadata.binaryName === undefined ? {} : { binaryName: metadata.binaryName }),
    supportsStdinPrompt: config?.kind === "cli" && config.stdinMode !== undefined,
    supportsMcpSpawn: supportsMcpAtSpawn(metadata.id),
    ...(config ? { config } : {}),
    ...(acpConfig ? { acpConfig } : {})
  };
}
export function listSpawnableAgents() {
  return Object.freeze(catalog.map(spawnable).filter(Boolean));
}
export function resolveSpawnableAgent(input) {
  const id = planner.resolveId(input),
    entry = catalog.find((entry) => entry.metadata.id === id);
  return entry ? spawnable(entry) : undefined;
}
export function resolveConfig(input, env = process.env) {
  const id = planner.resolveId(input);
  if (id == null) throw new Error(`Unknown agent "${input}".`);
  return {
    agentId: id,
    binaryName:
      env.POE_AGENT_BINARY?.trim() ||
      catalog.find((entry) => entry.metadata.id === id).metadata.binaryName,
    spawnConfig: configs.get(id)
  };
}
export function buildSpawnArgs(input, options) {
  const result = planner.build(
    input,
    JSON.stringify({ ...options, cwd: options.cwd ?? process.cwd() }),
    process.env.POE_AGENT_BINARY
  );
  result.env ??= undefined;
  return result;
}
export function mergeSpawnEnvironment(...sources) {
  return Object.assign(
    Object.create(null),
    native.spawnMergeEnvironment(
      sources.map((source) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(source ?? {}).map(([key, value]) => [
              key,
              value === undefined ? null : value
            ])
          )
        )
      )
    )
  );
}
export { createSpawnRetry, calculateBackoffMs, defaultIsRetryable } from "./retry.js";
