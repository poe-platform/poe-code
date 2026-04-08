import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  runMutations,
  configMutation,
  fileMutation,
  readFileIfExists,
  type ConfigObject
} from "@poe-code/config-mutations";
import type { McpServerEntry, ApplyOptions } from "./types.js";
import {
  getAgentConfig,
  resolveConfigPath,
  isSupported
} from "./configs.js";
import { getShapeTransformer } from "./shapes.js";

function getConfigDirectory(configPath: string): string {
  return path.dirname(configPath);
}

export class UnsupportedAgentError extends Error {
  constructor(agentId: string) {
    super(`Unsupported agent: ${agentId}`);
    this.name = "UnsupportedAgentError";
  }
}

function isConfigObject(value: unknown): value is ConfigObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveServerMap(
  document: ConfigObject,
  configKey: string
): ConfigObject {
  const value = document[configKey];
  return isConfigObject(value) ? value : {};
}

function mergeServerMap(
  document: ConfigObject,
  configKey: string,
  servers: ConfigObject
): ConfigObject {
  return { ...document, [configKey]: servers };
}

function expandHomePath(configPath: string, homeDir: string): string {
  if (!configPath.startsWith("~")) {
    return configPath;
  }

  if (configPath === "~") {
    return homeDir;
  }

  if (configPath.startsWith("~/")) {
    return path.join(homeDir, configPath.slice(2));
  }

  return path.join(homeDir, configPath.slice(1));
}

function parseYamlDocument(content: string): ConfigObject {
  if (content.trim() === "") {
    return {};
  }

  const parsed = parseYaml(content);
  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (!isConfigObject(parsed)) {
    throw new Error("Expected YAML document to be an object.");
  }

  return parsed;
}

function serializeYamlDocument(document: ConfigObject): string {
  const serialized = stringifyYaml(document);
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

async function readYamlConfig(
  configPath: string,
  options: ApplyOptions
): Promise<ConfigObject> {
  const absolutePath = expandHomePath(configPath, options.homeDir);
  const existingContent = await readFileIfExists(options.fs, absolutePath);

  if (existingContent === null) {
    return {};
  }

  return parseYamlDocument(existingContent);
}

async function writeYamlConfig(
  configPath: string,
  document: ConfigObject,
  options: ApplyOptions
): Promise<void> {
  if (options.dryRun) {
    return;
  }

  const absolutePath = expandHomePath(configPath, options.homeDir);
  const configDir = path.dirname(absolutePath);

  await options.fs.mkdir(configDir, { recursive: true });
  await options.fs.writeFile(absolutePath, serializeYamlDocument(document), {
    encoding: "utf8"
  });
}

function removeServer(
  document: ConfigObject,
  configKey: string,
  serverName: string
): { changed: boolean; content: ConfigObject } {
  const servers = resolveServerMap(document, configKey);
  if (!(serverName in servers)) {
    return { changed: false, content: document };
  }

  const nextServers = { ...servers };
  delete nextServers[serverName];

  if (Object.keys(nextServers).length === 0) {
    const nextDocument = { ...document };
    delete nextDocument[configKey];
    return { changed: true, content: nextDocument };
  }

  return {
    changed: true,
    content: mergeServerMap(document, configKey, nextServers)
  };
}

export async function configure(
  agentId: string,
  server: McpServerEntry,
  options: ApplyOptions
): Promise<void> {
  if (!isSupported(agentId)) {
    throw new UnsupportedAgentError(agentId);
  }

  const config = getAgentConfig(agentId)!;
  const configPath = resolveConfigPath(config, options.platform);
  const shapeTransformer = getShapeTransformer(config.shape);
  const shaped = shapeTransformer(server);

  if (shaped === undefined) {
    await unconfigure(agentId, server.name, options);
    return;
  }

  if (config.format === "yaml") {
    const document = await readYamlConfig(configPath, options);
    const servers = resolveServerMap(document, config.configKey);
    const nextDocument = mergeServerMap(document, config.configKey, {
      ...servers,
      [server.name]: shaped as unknown as ConfigObject
    });

    await writeYamlConfig(configPath, nextDocument, options);
    return;
  }

  const configDir = getConfigDirectory(configPath);

  await runMutations(
    [
      fileMutation.ensureDirectory({
        path: configDir,
        label: `Ensure directory ${configDir}`
      }),
      // Use transform to replace the server entry entirely (not deep-merge)
      // This ensures old fields like 'args' are removed when switching to array 'command'
      configMutation.transform({
        target: configPath,
        format: config.format,
        transform: (document) => {
          const servers = resolveServerMap(document, config.configKey);
          const newServers = {
            ...servers,
            [server.name]: shaped as unknown as ConfigObject
          };
          return {
            changed: true,
            content: mergeServerMap(document, config.configKey, newServers)
          };
        },
        label: `Add ${server.name} to ${configPath}`
      })
    ],
    {
      fs: options.fs,
      homeDir: options.homeDir,
      dryRun: options.dryRun,
      observers: options.observers
    }
  );
}

export async function unconfigure(
  agentId: string,
  serverName: string,
  options: ApplyOptions
): Promise<void> {
  if (!isSupported(agentId)) {
    throw new UnsupportedAgentError(agentId);
  }

  const config = getAgentConfig(agentId)!;
  const configPath = resolveConfigPath(config, options.platform);

  if (config.format === "yaml") {
    const document = await readYamlConfig(configPath, options);
    const { changed, content } = removeServer(
      document,
      config.configKey,
      serverName
    );

    if (!changed) {
      return;
    }

    await writeYamlConfig(configPath, content, options);
    return;
  }

  await runMutations(
    [
      configMutation.prune({
        target: configPath,
        format: config.format,
        shape: {
          [config.configKey]: {
            [serverName]: {}
          }
        },
        label: `Remove ${serverName} from ${configPath}`
      })
    ],
    {
      fs: options.fs,
      homeDir: options.homeDir,
      dryRun: options.dryRun,
      observers: options.observers
    }
  );
}
