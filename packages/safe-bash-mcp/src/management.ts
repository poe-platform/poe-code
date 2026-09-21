import { commandRuntimeIdentity, createOutputOperation, type CommandDefinition } from "@poe-platform/safe-bash/contracts";
import { argumentText, commandLimit, emit, errorDetails, shellWord, textLine, validateCommandName } from "./commands.js";
import { initRemoteMcpConfiguration, type ConfigurationOptions, type InitRemoteMcpServer } from "./configuration.js";
import { generateRemoteMcpArtifact, type ArtifactGenerationOptions } from "./artifact.js";
import { authenticateRemoteMcpServer, type RemoteMcpAuthenticationOptions, type RemoteMcpAuthenticationResult } from "./authentication.js";
import type { ConfigurationBindingOptions } from "./runtime-configuration.js";

export interface RemoteMcpManagementOptions extends ConfigurationOptions {
  readonly name?: string;
  readonly signal?: AbortSignal;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly generation?: ArtifactGenerationOptions;
  readonly authentication?: Omit<RemoteMcpAuthenticationOptions, "binding"> & { readonly binding?: ConfigurationBindingOptions };
}

function authenticationArguments(args: readonly string[]): { name: string; json: boolean; noBrowser?: boolean; requestTimeoutMs?: number } {
  let name: string | undefined;
  let json = false;
  let noBrowser: boolean | undefined;
  let requestTimeoutMs: number | undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      if (json) throw new Error("--json can only be supplied once");
      json = true;
    } else if (arg === "--no-browser" || arg === "--browser" || arg.startsWith("--browser=")) {
      if (noBrowser !== undefined) throw new Error("Browser selection can only be supplied once");
      const mode = arg === "--no-browser" ? "none" : arg === "--browser" ? args[++index] : arg.slice("--browser=".length);
      if (mode !== "none" && mode !== "host") throw new Error("--browser requires none or host");
      noBrowser = mode === "none";
    } else if (arg === "--timeout-ms" || arg.startsWith("--timeout-ms=")) {
      if (requestTimeoutMs !== undefined) throw new Error("--timeout-ms can only be supplied once");
      const value = arg === "--timeout-ms" ? args[++index] : arg.slice("--timeout-ms=".length);
      if (value === undefined || value.length === 0 || [...value].some(char => char < "0" || char > "9")) throw new Error("--timeout-ms requires a positive supported millisecond interval");
      requestTimeoutMs = Number(value);
      if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2_147_483_647) throw new Error("--timeout-ms requires a positive supported millisecond interval");
    } else if (arg === "--") {
      if (name !== undefined || index + 2 !== args.length) throw new Error("auth requires exactly one server name");
      name = args[++index];
    } else {
      if (arg.startsWith("-") || name !== undefined) throw new Error(`Unknown auth argument '${arg}'`);
      name = arg;
    }
  }
  if (name === undefined) throw new Error("auth requires a server name");
  return { name, json, noBrowser, requestTimeoutMs };
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
  const authenticationUsage = `Usage: ${textLine(shellWord(name))} auth <server> [--json] [--browser none|host]`;
  const authenticationGuidance = [
    "Auth verifies access without listing or calling tools. Headless login prints",
    "the complete authorization URL and exact redirect before waiting for consent.",
    "Keep this command running while opening the URL. --json emits one JSON record",
    "per authorization attempt. After URL output, connection status goes to stderr.",
    "--no-browser (default) never launches a browser; --browser host uses the",
    "host-configured opener. Cached credentials may connect without another URL.", "",
    "--timeout-ms <milliseconds> bounds the complete authentication operation",
    "(default 120000). Host callback timeouts may impose a shorter limit."
  ];
  const authenticationHelp = [authenticationUsage, "", ...authenticationGuidance, "", "  --help  Show this help.", ""].join("\n");
  const help = [
    `Usage: ${textLine(shellWord(name))} init [--format json|config|env]`,
    `       ${textLine(shellWord(name))} generate [--format json|config|module]`,
    `       ${textLine(shellWord(name))} auth <server> [--json] [--browser none|host]`, "",
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
    ...authenticationGuidance, "",
    "  --help  Show this help.", ""
  ].join("\n");
  return {
    name,
    description: "Initialize, authenticate and generate remote MCP commands",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      const signal = factorySignal === undefined ? context.signal : AbortSignal.any([context.signal, factorySignal]);
      const operation = createOutputOperation({ signal, registerCleanup: context.registerCleanup }, context.stdout);
      const errors = operation.child(context.stderr);
      try {
        operation.signal.throwIfAborted();
        let output: string;
        let generationFormat: string | undefined;
        let authentication: ReturnType<typeof authenticationArguments> | undefined;
        try {
          const args = argumentText(context, maxInputBytes);
          if (args.length === 2 && args[0] === "auth" && args[1] === "--help") output = authenticationHelp;
          else if (args.length === 0 || (args.length === 1 && args[0] === "--help") || (args.length === 2 && ["init", "generate"].includes(args[0]) && args[1] === "--help")) output = help;
          else if (args[0] === "auth") {
            authentication = authenticationArguments(args);
            if (!initialization.configuration.servers.some(server => server.name === authentication!.name)) throw new Error(`Unknown remote MCP server '${authentication.name}'`);
            output = "";
          }
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
        if (authentication !== undefined) {
          const selected = authentication;
          const server = initialization.configuration.servers.find(server => server.name === selected.name)!;
          const settings = options.authentication;
          const authSignal = settings?.signal;
          let emittedBytes = 0;
          let emittedUrl = false;
          let outputFailure: unknown;
          let result: RemoteMcpAuthenticationResult;
          try {
            result = await authenticateRemoteMcpServer(server, {
              ...settings, binding: settings?.binding ?? { env: context.env },
              noBrowser: selected.noBrowser ?? settings?.noBrowser ?? true,
              requestTimeoutMs: selected.requestTimeoutMs ?? settings?.requestTimeoutMs,
              signal: authSignal === undefined ? operation.signal : AbortSignal.any([operation.signal, authSignal]),
              async onAuthorizationUrl(request) {
                const text = selected.json ? `${JSON.stringify(request)}\n` : `Authorization URL: ${textLine(request.authorizationUrl)}\nRedirect URI: ${textLine(request.redirectUri)}\n`;
                try { await emit(operation, text, maxOutputBytes - emittedBytes); }
                catch (error) { outputFailure = error; throw error; }
                emittedBytes += Buffer.byteLength(text, "utf8");
                emittedUrl = true;
                await settings?.onAuthorizationUrl?.(request);
              }
            });
          } catch (error) {
            if (outputFailure !== undefined) throw outputFailure;
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
            return { exitCode: 1 };
          }
          const summary = selected.json ? `${JSON.stringify({ name: result.name, url: result.url, connected: true })}\n` : `Connected to ${textLine(shellWord(result.name))}.\n`;
          await emit(emittedUrl ? errors : operation, summary, emittedUrl ? maxOutputBytes : maxOutputBytes - emittedBytes);
          return { exitCode: 0 };
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
