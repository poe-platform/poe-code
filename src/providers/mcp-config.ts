import type { McpContext, McpRunOptions } from "../cli/service-registry.js";
import {
  createServiceManifest,
  jsonMergeMutation,
  jsonPruneMutation,
  tomlMergeMutation,
  tomlPruneMutation,
  type ServiceMutation
} from "../services/service-manifest.js";
import type { TomlTable } from "../utils/toml.js";
import type { JsonObject } from "../utils/json.js";
import {
  getCurrentExecutionContext,
  toMcpServerCommand,
  type ExecutionCommand
} from "../utils/execution-context.js";

/**
 * Context passed to MCP value factory functions
 */
export interface McpValueContext {
  /** The detected execution command (e.g., npx, poe-code, npm) */
  execCommand: ExecutionCommand;
  /** The MCP subcommand to append */
  subcommand: string;
}

export interface McpConfigJson {
  configFile: string;
  configKey: string;
  /** Static value (legacy) or factory function for dynamic value */
  value?: JsonObject | ((ctx: McpValueContext) => JsonObject);
}

export interface McpConfigToml {
  configFile: string;
  configKey: string;
  format: "toml";
}

export type McpConfig = McpConfigJson | McpConfigToml;

interface McpMutationOptions {
  dryRun?: boolean;
}

type McpValueOption = JsonObject | ((ctx: McpValueContext) => JsonObject) | undefined;

function getMcpServerValue(): JsonObject {
  const context = getCurrentExecutionContext(import.meta.url);
  const mcpCommand = toMcpServerCommand(context.command, "mcp");
  return {
    "poe-code": {
      command: mcpCommand.command,
      args: mcpCommand.args
    }
  };
}

function resolveServerValue(customValue: McpValueOption): JsonObject {
  if (customValue === undefined) {
    return getMcpServerValue();
  }
  if (typeof customValue === "function") {
    const context = getCurrentExecutionContext(import.meta.url);
    const mcpCommand = toMcpServerCommand(context.command, "mcp");
    return customValue({
      execCommand: context.command,
      subcommand: mcpCommand.args[mcpCommand.args.length - 1]
    });
  }
  return customValue;
}

export function createMcpMutations(config: McpConfig): {
  configure: ServiceMutation<McpMutationOptions>[];
  unconfigure: ServiceMutation<McpMutationOptions>[];
} {
  if ("format" in config && config.format === "toml") {
    return {
      configure: [
        tomlMergeMutation<McpMutationOptions>({
          target: config.configFile,
          value: () => ({ [config.configKey]: getMcpServerValue() } as TomlTable)
        })
      ],
      unconfigure: [
        tomlPruneMutation<McpMutationOptions>({
          target: config.configFile,
          prune: (document) => {
            const servers = document[config.configKey];
            if (!servers || typeof servers !== "object") {
              return { changed: false, result: document };
            }
            const serversRecord = servers as Record<string, unknown>;
            if (!("poe-code" in serversRecord)) {
              return { changed: false, result: document };
            }
            delete serversRecord["poe-code"];
            if (Object.keys(serversRecord).length === 0) {
              delete document[config.configKey];
            }
            return { changed: true, result: document };
          }
        })
      ]
    };
  }

  const customValue = "value" in config ? config.value : undefined;
  return {
    configure: [
      jsonMergeMutation<McpMutationOptions>({
        target: config.configFile,
        value: () => {
          const serverValue = resolveServerValue(customValue);
          return { [config.configKey]: serverValue };
        }
      })
    ],
    unconfigure: [
      jsonPruneMutation<McpMutationOptions>({
        target: config.configFile,
        shape: () => ({ [config.configKey]: { "poe-code": true } })
      })
    ]
  };
}

export function createMcpConfigureRunner(
  providerId: string,
  mutations: ServiceMutation<McpMutationOptions>[]
) {
  return async (context: McpContext, options?: McpRunOptions): Promise<void> => {
    const mcpManifest = createServiceManifest({
      id: `${providerId}-mcp`,
      summary: `MCP configuration for ${providerId}`,
      configure: mutations,
      unconfigure: []
    });

    await mcpManifest.configure(
      {
        fs: context.command.fs,
        env: context.env,
        command: context.command,
        options: { dryRun: options?.dryRun }
      },
      {
        observers: {
          onStart: (details) => {
            if (options?.dryRun) {
              context.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details, outcome) => {
            if (!options?.dryRun && outcome.changed) {
              context.logger.verbose(details.label);
            }
          }
        }
      }
    );
  };
}

export function createMcpUnconfigureRunner(
  providerId: string,
  mutations: ServiceMutation<McpMutationOptions>[]
) {
  return async (context: McpContext, options?: McpRunOptions): Promise<void> => {
    const mcpManifest = createServiceManifest({
      id: `${providerId}-mcp`,
      summary: `MCP configuration for ${providerId}`,
      configure: mutations,
      unconfigure: []
    });

    await mcpManifest.configure(
      {
        fs: context.command.fs,
        env: context.env,
        command: context.command,
        options: { dryRun: options?.dryRun }
      },
      {
        observers: {
          onStart: (details) => {
            if (options?.dryRun) {
              context.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details, outcome) => {
            if (!options?.dryRun && outcome.changed) {
              context.logger.verbose(details.label);
            }
          }
        }
      }
    );
  };
}
