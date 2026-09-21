import { commandRuntimeIdentity, createOutputOperation, type CommandDefinition } from "@poe-platform/safe-bash/contracts";
import { argumentText, commandLimit, emit, errorDetails, shellWord, textLine, validateCommandName } from "./commands.js";
import { initRemoteMcpConfiguration, type ConfigurationOptions, type InitRemoteMcpServer } from "./configuration.js";
import { generateRemoteMcpArtifact, type ArtifactGenerationOptions } from "./artifact.js";

export interface RemoteMcpManagementOptions extends ConfigurationOptions {
  readonly name?: string;
  readonly signal?: AbortSignal;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly generation?: ArtifactGenerationOptions;
}

/** Create configuration and artifact commands for a host-owned static remote registry. */
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
    `Usage: ${textLine(shellWord(name))} init [--format json|config|env]`,
    `       ${textLine(shellWord(name))} generate [--format json|config|module]`, "",
    "Prepare configuration and an empty credential environment template for the remote registry.", "",
    "Formats:", "  json    Configuration and environment template together (default).",
    "  config  Versioned server configuration with credential references.", "  env     Empty dotenv entries with credential guidance.", "",
    "OAuth entries include app/client ID, client secret, scopes, exact registered",
    "redirect URI, access token, refresh token and expiry in Unix epoch milliseconds.",
    "Optional relative lifetime uses seconds; original issuance time uses epoch",
    "milliseconds for delayed imports. Absolute expiry takes precedence.",
    "Public scope/redirect fallbacks are stored in configuration. Secrets remain",
    "empty in the template; initialization does not read credentials or connect.", "",
    "Generate resolves absent schemas and emits a reproducible artifact. Supplied",
    "schemas are authoritative and require no credentials or discovery connection.",
    "Generation formats:", "  json    Validated schema artifact with its content digest (default).",
    "  config  Resolved configuration with every tool schema.",
    "  module  Dependency-free ESM data module exporting the artifact as default.",
    "Credentials remain environment references in every generated format.", "",
    "  --help  Show this help.", ""
  ].join("\n");
  return {
    name,
    description: "Initialize remote MCP credentials and generate reproducible schema artifacts",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      const signal = factorySignal === undefined ? context.signal : AbortSignal.any([context.signal, factorySignal]);
      const operation = createOutputOperation({ signal, registerCleanup: context.registerCleanup }, context.stdout);
      const errors = operation.child(context.stderr);
      try {
        operation.signal.throwIfAborted();
        let output: string;
        let generationFormat: string | undefined;
        try {
          const args = argumentText(context, maxInputBytes);
          if (args.length === 0 || (args.length === 1 && args[0] === "--help") || (args.length === 2 && (args[0] === "init" || args[0] === "generate") && args[1] === "--help")) output = help;
          else {
            if (args[0] !== "init" && args[0] !== "generate") throw new Error(`Unknown remote MCP management command '${args[0]}'`);
            const command = args[0];
            const formats = command === "init" ? ["json", "config", "env"] : ["json", "config", "module"];
            let format: string | undefined;
            for (let index = 1; index < args.length; index++) {
              const arg = args[index];
              if (arg !== "--format" && !arg.startsWith("--format=")) throw new Error(`Unknown ${command} argument '${arg}'`);
              if (format !== undefined) throw new Error("--format can only be supplied once");
              format = arg === "--format" ? args[++index] : arg.slice("--format=".length);
              if (format === undefined) throw new Error(`--format requires ${formats.join(", ")}`);
            }
            if (format !== undefined && !formats.includes(format)) throw new Error(`--format requires ${formats.join(", ")}`);
            if (command === "generate") { generationFormat = format ?? "json"; output = ""; }
            else if (format === undefined || format === "json") output = `${JSON.stringify(initialization, null, 2)}\n`;
            else if (format === "config") output = `${JSON.stringify(initialization.configuration, null, 2)}\n`;
            else output = initialization.envTemplate;
          }
        } catch (error) {
          operation.signal.throwIfAborted();
          await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
          return { exitCode: 2 };
        }
        if (generationFormat !== undefined) {
          try {
            const generation = options.generation;
            const schemaSignal = generation?.schema?.signal;
            const generated = await generateRemoteMcpArtifact(initialization.configuration, {
              ...options, ...generation,
              binding: generation?.binding ?? { env: context.env },
              schema: { ...generation?.schema, signal: schemaSignal === undefined ? operation.signal : AbortSignal.any([operation.signal, schemaSignal]) }
            });
            output = generationFormat === "module" ? generated.module : generationFormat === "config" ? `${JSON.stringify(generated.artifact.configuration, null, 2)}\n` : generated.json;
          } catch (error) {
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
            return { exitCode: 1 };
          }
        }
        await emit(operation, output, maxOutputBytes);
        return { exitCode: 0 };
      } finally { await operation.close(); }
    }
  };
}
