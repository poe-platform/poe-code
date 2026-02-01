import path from "node:path";
import {
  runMutations,
  configMutation,
  fileMutation,
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
          const serversKey = config.configKey;
          const servers = (document[serversKey] ?? {}) as ConfigObject;
          const newServers = {
            ...servers,
            [server.name]: shaped as unknown as ConfigObject
          };
          return {
            changed: true,
            content: { ...document, [serversKey]: newServers }
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
