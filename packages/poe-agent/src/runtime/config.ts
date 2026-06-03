import type { AgentPlugin, McpServerConfig } from "./plugin-types.js";

export type ResolvedAgentConfig = {
  model?: string;
  plugins: AgentPlugin[];
};

type AgentPluginWithDependencies = AgentPlugin & {
  dependencies?: string[];
  dependsOn?: string[];
};

function cloneStringArray(values: readonly string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }

  return [...values];
}

function cloneStringRecord(values: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }

  return { ...values };
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => cloneUnknown(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneUnknown(entry)])
    );
  }

  return value;
}

function normalizeName(name: string, label: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} name must be a non-empty string.`);
  }

  return normalized;
}

export function cloneAgentPlugin(plugin: AgentPlugin): AgentPlugin {
  const dependencies = readDependencies(plugin);

  return Object.freeze({
    ...plugin,
    name: normalizeName(plugin.name, "Plugin"),
    ...(plugin.tools === undefined
      ? {}
      : {
          tools: Object.freeze(
            plugin.tools.map(tool =>
              Object.freeze({
                ...tool,
                ...(tool.inputSchema === undefined ? {} : { inputSchema: cloneUnknown(tool.inputSchema) }),
              }),
            ),
          ),
        }),
    ...(plugin.hooks === undefined
      ? {}
      : {
          hooks: Object.freeze({ ...plugin.hooks }),
        }),
    ...(dependencies.length === 0
      ? {}
      : {
          dependencies: Object.freeze(dependencies),
        }),
  } as AgentPlugin);
}

export function cloneMcpServerConfig(config: McpServerConfig): McpServerConfig {
  return Object.freeze({
    ...config,
    name: normalizeName(config.name, "MCP server"),
    command: normalizeName(config.command, "MCP server command"),
    ...(config.args === undefined ? {} : { args: Object.freeze(cloneStringArray(config.args)) as string[] }),
    ...(config.env === undefined
      ? {}
      : { env: Object.freeze(cloneStringRecord(config.env)) as Record<string, string> }),
  }) as McpServerConfig;
}

export function createResolvedAgentConfig(input: Partial<ResolvedAgentConfig> = {}): ResolvedAgentConfig {
  const model = input.model?.trim();

  return Object.freeze({
    ...(model === undefined || model.length === 0 ? {} : { model }),
    plugins: Object.freeze((input.plugins ?? []).map(plugin => cloneAgentPlugin(plugin))) as AgentPlugin[],
  }) as ResolvedAgentConfig;
}

export function toRuntimePlugins(config: ResolvedAgentConfig): AgentPlugin[] {
  return [...config.plugins];
}

export function resolvePluginSetupOrder(plugins: AgentPlugin[]): AgentPlugin[] {
  const byName = new Map<string, AgentPlugin>();

  for (const plugin of plugins) {
    const pluginName = normalizeName(plugin.name, "Plugin");
    if (byName.has(pluginName)) {
      throw new Error(`Duplicate plugin name "${pluginName}".`);
    }

    byName.set(pluginName, plugin);
  }

  const ordered: AgentPlugin[] = [];
  const visitState = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  const visit = (pluginName: string): void => {
    const currentState = visitState.get(pluginName);

    if (currentState === "visited") {
      return;
    }

    if (currentState === "visiting") {
      const cycleStart = stack.indexOf(pluginName);
      const cycle = cycleStart >= 0 ? [...stack.slice(cycleStart), pluginName] : [...stack, pluginName];
      throw new Error(`Circular plugin dependencies detected: "${cycle.join('" -> "')}".`);
    }

    const plugin = byName.get(pluginName);
    if (!plugin) {
      throw new Error(`Unknown plugin "${pluginName}".`);
    }

    visitState.set(pluginName, "visiting");
    stack.push(pluginName);

    for (const dependencyName of readDependencies(plugin)) {
      if (dependencyName === pluginName) {
        throw new Error(`Plugin "${pluginName}" cannot depend on itself.`);
      }

      if (!byName.has(dependencyName)) {
        throw new Error(
          `Unknown plugin dependency "${dependencyName}" for plugin "${pluginName}".`,
        );
      }

      visit(dependencyName);
    }

    stack.pop();
    visitState.set(pluginName, "visited");
    ordered.push(plugin);
  };

  for (const plugin of plugins) {
    visit(normalizeName(plugin.name, "Plugin"));
  }

  return ordered;
}

function readDependencies(plugin: AgentPlugin): string[] {
  const dependencyValues = [
    ...(plugin as AgentPluginWithDependencies).dependencies ?? [],
    ...(plugin as AgentPluginWithDependencies).dependsOn ?? [],
  ];

  if (dependencyValues.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const dependencyName of dependencyValues) {
    if (typeof dependencyName !== "string") {
      continue;
    }

    const name = dependencyName.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push(name);
  }

  return normalized;
}
