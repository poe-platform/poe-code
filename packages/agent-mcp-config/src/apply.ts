import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  runMutations,
  configMutation,
  fileMutation,
  type ConfigObject
} from "@poe-code/config-mutations";
import type { McpServerEntry, ApplyOptions } from "./types.js";
import { getAgentConfig, resolveConfigPath, isSupported } from "./configs.js";
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

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}

function assertHttpUrl(value: unknown): asserts value is string {
  assertNonEmptyString(value, "MCP HTTP URL must be a valid http or https URL.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MCP HTTP URL must be a valid http or https URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("MCP HTTP URL must be a valid http or https URL.");
  }
}

function validateServerEntry(server: McpServerEntry): void {
  assertNonEmptyString(server.name, "MCP server name must be a non-empty string.");

  if (server.config.transport === "stdio") {
    assertNonEmptyString(server.config.command, "MCP stdio command must be a non-empty string.");
    return;
  }

  assertHttpUrl(server.config.url);
}

function resolveServerMap(document: ConfigObject, configKey: string): ConfigObject {
  const value = document[configKey];

  if (value === undefined) {
    return {};
  }

  if (!isConfigObject(value)) {
    throw new Error(`Expected ${configKey} to be an object.`);
  }

  return value;
}

function mergeServerMap(
  document: ConfigObject,
  configKey: string,
  servers: ConfigObject
): ConfigObject {
  return { ...document, [configKey]: servers };
}

export async function configure(
  agentId: string,
  server: McpServerEntry,
  options: ApplyOptions
): Promise<void> {
  if (!isSupported(agentId)) {
    throw new UnsupportedAgentError(agentId);
  }

  validateServerEntry(server);

  const config = getAgentConfig(agentId)!;
  const configPath = resolveConfigPath(config, options.platform);
  const shapeTransformer = getShapeTransformer(config.shape);
  const shaped = shapeTransformer(server);
  const enabledServer: McpServerEntry = { ...server, enabled: true };
  const enabledShaped = shapeTransformer(enabledServer);

  if (shaped === undefined) {
    await unconfigure(agentId, enabledServer, options);
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
          const existingServer = Object.hasOwn(servers, server.name)
            ? servers[server.name]
            : undefined;
          const shapedServer = shaped as unknown as ConfigObject;
          const enabledShapedServer = enabledShaped as unknown as ConfigObject | undefined;

          if (existingServer !== undefined && isDeepStrictEqual(existingServer, shapedServer)) {
            return { changed: false, content: document };
          }

          if (
            existingServer !== undefined &&
            (enabledShapedServer === undefined ||
              !isDeepStrictEqual(existingServer, enabledShapedServer))
          ) {
            throw new Error(
              `MCP server "${server.name}" already exists with different configuration in ${configPath}.`
            );
          }

          const newServers = {
            ...servers,
            [server.name]: shapedServer
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
  server: string | McpServerEntry,
  options: ApplyOptions
): Promise<void> {
  if (!isSupported(agentId)) {
    throw new UnsupportedAgentError(agentId);
  }

  const config = getAgentConfig(agentId)!;
  const configPath = resolveConfigPath(config, options.platform);
  const serverName = typeof server === "string" ? server : server.name;
  const expectedServer =
    typeof server === "string" ? undefined : getShapeTransformer(config.shape)(server);

  await runMutations(
    [
      configMutation.transform({
        target: configPath,
        format: config.format,
        transform: (document) => {
          const servers = resolveServerMap(document, config.configKey);
          if (!Object.hasOwn(servers, serverName)) {
            return { changed: false, content: document };
          }
          if (
            expectedServer !== undefined &&
            !isDeepStrictEqual(servers[serverName], expectedServer)
          ) {
            return { changed: false, content: document };
          }
          const newServers = { ...servers };
          delete newServers[serverName];
          if (Object.keys(newServers).length === 0) {
            const newDocument = { ...document };
            delete newDocument[config.configKey];
            return { changed: true, content: newDocument };
          }
          return {
            changed: true,
            content: mergeServerMap(document, config.configKey, newServers)
          };
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
