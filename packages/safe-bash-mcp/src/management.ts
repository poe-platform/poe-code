import { commandRuntimeIdentity, createOutputOperation, type CommandDefinition } from "@poe-platform/safe-bash/contracts";
import { argumentText, commandLimit, emit, errorDetails, shellWord, textLine, validateCommandName } from "./commands.js";
import { initRemoteMcpConfiguration, type ConfigurationOptions, type InitRemoteMcpServer } from "./configuration.js";

export interface RemoteMcpManagementOptions extends ConfigurationOptions {
  readonly name?: string;
  readonly signal?: AbortSignal;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
}

/** Create an init command for a host-owned static remote registry. */
export function createRemoteMcpManagementCommand(
  servers: readonly InitRemoteMcpServer[],
  options: RemoteMcpManagementOptions = {}
): CommandDefinition {
  const name = options.name ?? "mcp";
  validateCommandName(name);
  if (servers.some(server => server.name === name)) throw new Error(`Management command conflicts with generated command: ${name}`);
  const initialization = initRemoteMcpConfiguration(servers, options);
  const maxInputBytes = commandLimit(options.maxInputBytes ?? 1024 * 1024, "maxInputBytes");
  const maxOutputBytes = commandLimit(options.maxOutputBytes ?? 16 * 1024 * 1024, "maxOutputBytes");
  const factorySignal = options.signal;
  const help = [
    `Usage: ${textLine(shellWord(name))} init [--format json|config|env]`, "",
    "Prepare configuration and an empty credential environment template for the remote registry.", "",
    "Formats:", "  json    Configuration and environment template together (default).",
    "  config  Versioned server configuration with credential references.", "  env     Empty dotenv entries with credential guidance.", "",
    "OAuth entries include app/client ID, client secret, scopes, exact registered",
    "redirect URI, access token, refresh token and expiry in Unix epoch milliseconds.",
    "Public scope/redirect fallbacks are stored in configuration. Secrets remain",
    "empty in the template; initialization does not read credentials or connect.", "",
    "  --help  Show this help.", ""
  ].join("\n");
  return {
    name,
    description: "Initialize remote MCP configuration and credential environment references",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      const signal = factorySignal === undefined ? context.signal : AbortSignal.any([context.signal, factorySignal]);
      const operation = createOutputOperation({ signal, registerCleanup: context.registerCleanup }, context.stdout);
      const errors = operation.child(context.stderr);
      try {
        operation.signal.throwIfAborted();
        let output: string;
        try {
          const args = argumentText(context, maxInputBytes);
          if (args.length === 0 || (args.length === 1 && args[0] === "--help") || (args.length === 2 && args[0] === "init" && args[1] === "--help")) output = help;
          else {
            if (args[0] !== "init") throw new Error(`Unknown remote MCP management command '${args[0]}'`);
            let format: string | undefined;
            for (let index = 1; index < args.length; index++) {
              const arg = args[index];
              if (arg !== "--format" && !arg.startsWith("--format=")) throw new Error(`Unknown init argument '${arg}'`);
              if (format !== undefined) throw new Error("--format can only be supplied once");
              format = arg === "--format" ? args[++index] : arg.slice("--format=".length);
              if (format === undefined) throw new Error("--format requires json, config or env");
            }
            if (format === undefined || format === "json") output = `${JSON.stringify(initialization, null, 2)}\n`;
            else if (format === "config") output = `${JSON.stringify(initialization.configuration, null, 2)}\n`;
            else if (format === "env") output = initialization.envTemplate;
            else throw new Error("--format requires json, config or env");
          }
        } catch (error) {
          operation.signal.throwIfAborted();
          await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
          return { exitCode: 2 };
        }
        await emit(operation, output, maxOutputBytes);
        return { exitCode: 0 };
      } finally { await operation.close(); }
    }
  };
}
