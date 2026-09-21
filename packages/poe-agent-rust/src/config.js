import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
function unwrap(result) {
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}
function stringInput(value) {
  if (typeof value !== "string") value.trim();
  return value;
}
function name(value, label) {
  return unwrap(native.normalizeConfigName(stringInput(value), label));
}
function readDependencies(plugin) {
  return [...(plugin.dependencies ?? []), ...(plugin.dependsOn ?? [])].filter(
    (value) => typeof value === "string"
  );
}
function cloneUnknown(value) {
  if (Array.isArray(value)) return value.map(cloneUnknown);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneUnknown(entry)])
    );
  return value;
}
export function cloneAgentPlugin(plugin) {
  const dependencies = native.normalizePluginDependencies(readDependencies(plugin));
  return Object.freeze({
    ...plugin,
    name: name(plugin.name, "Plugin"),
    ...(plugin.tools === undefined
      ? {}
      : {
          tools: Object.freeze(
            plugin.tools.map((tool) =>
              Object.freeze({
                ...tool,
                ...(tool.inputSchema === undefined
                  ? {}
                  : { inputSchema: cloneUnknown(tool.inputSchema) })
              })
            )
          )
        }),
    ...(plugin.hooks === undefined ? {} : { hooks: Object.freeze({ ...plugin.hooks }) }),
    ...(dependencies.length === 0 ? {} : { dependencies: Object.freeze(dependencies) })
  });
}
export function cloneMcpServerConfig(config) {
  return Object.freeze({
    ...config,
    name: name(config.name, "MCP server"),
    command: name(config.command, "MCP server command"),
    ...(config.args === undefined
      ? {}
      : { args: Object.freeze(config.args ? [...config.args] : undefined) }),
    ...(config.env === undefined
      ? {}
      : { env: Object.freeze(config.env ? { ...config.env } : undefined) })
  });
}
export function createResolvedAgentConfig(input = {}) {
  const supplied = input.model;
  const model =
    supplied === undefined || supplied === null
      ? undefined
      : native.trimConfigString(stringInput(supplied));
  return Object.freeze({
    ...(!model ? {} : { model }),
    plugins: Object.freeze((input.plugins ?? []).map(cloneAgentPlugin))
  });
}
export function toRuntimePlugins(config) {
  return [...config.plugins];
}
export function resolvePluginSetupOrder(plugins) {
  const graph = new native.NativePluginGraph();
  for (const plugin of plugins) unwrap(graph.add(stringInput(plugin.name)));
  for (const plugin of plugins) {
    let effect = unwrap(graph.begin(stringInput(plugin.name)));
    while (effect !== null) {
      effect = unwrap(graph.load(readDependencies(plugins[effect])));
    }
  }
  return graph.order().map((index) => plugins[index]);
}
