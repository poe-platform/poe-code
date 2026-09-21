import { posix } from "node:path";
import { commandRuntimeIdentity, collectBytes, toByteSource, createOutputOperation, type CommandDefinition } from "@poe-platform/safe-bash/contracts";
import { argumentText, commandLimit, emit, errorDetails, shellWord, textLine, validateCommandName } from "./commands.js";
import { initRemoteMcpConfiguration, type ConfigurationOptions, type InitRemoteMcpServer } from "./configuration.js";
import { generateRemoteMcpArtifact, type ArtifactGenerationOptions } from "./artifact.js";
import { authenticateRemoteMcpServer, type RemoteMcpAuthenticationOptions, type RemoteMcpAuthenticationResult } from "./authentication.js";
import { importRemoteMcpAuthentication, type RemoteMcpCredentialImportOptions, type RemoteMcpCredentialImportResult } from "./credential-import.js";
import type { ConfigurationBindingOptions } from "./runtime-configuration.js";
import { bindRemoteMcpConfiguration } from "./runtime-configuration.js";
import { accessRemoteMcpResources, snapshotRemoteMcpResourceRequest, type RemoteMcpResourceRequest, type RemoteMcpResourceOptions } from "./resources.js";
import { resetRemoteMcpAuthentication, type RemoteMcpCredentialResetOptions, type RemoteMcpCredentialResetResult } from "./credential-reset.js";

export interface RemoteMcpManagementOptions extends ConfigurationOptions {
  readonly name?: string;
  readonly signal?: AbortSignal;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly generation?: ArtifactGenerationOptions;
  readonly authentication?: Omit<RemoteMcpAuthenticationOptions, "binding"> & { readonly binding?: ConfigurationBindingOptions };
  readonly reset?: RemoteMcpCredentialResetOptions;
  readonly credentialImport?: RemoteMcpCredentialImportOptions;
  readonly resources?: RemoteMcpResourceOptions & { readonly binding?: ConfigurationBindingOptions };
}

function resourceArguments(args: readonly string[], maxInputBytes: number): { name: string; request: RemoteMcpResourceRequest } {
  const positional: string[] = [];
  let cursor: string | undefined;
  let templates = false;
  let literal = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (!literal && arg === "--") { literal = true; continue; }
    if (!literal && arg === "--templates") {
      if (templates) throw new Error("--templates can only be supplied once");
      templates = true;
    } else if (!literal && (arg === "--cursor" || arg.startsWith("--cursor="))) {
      if (cursor !== undefined) throw new Error("--cursor can only be supplied once");
      cursor = arg === "--cursor" ? args[++index] : arg.slice("--cursor=".length);
      if (cursor === undefined) throw new Error("--cursor requires a value");
    } else {
      if ((!literal && arg.startsWith("-")) || positional.length === 2) throw new Error(`Unknown resource argument '${arg}'`);
      positional.push(arg);
    }
  }
  const [name, uri] = positional;
  if (name === undefined) throw new Error("resource requires a server name");
  if (uri !== undefined && (templates || cursor !== undefined)) throw new Error("Resource reads cannot use --templates or --cursor");
  const request: RemoteMcpResourceRequest = uri === undefined ? { operation: templates ? "templates" : "list", ...(cursor === undefined ? {} : { cursor }) }
    : { operation: "read", uri };
  return { name, request: snapshotRemoteMcpResourceRequest(request, maxInputBytes) };
}

function credentialArguments(args: readonly string[]): { name: string; json: boolean; reset: boolean; noBrowser?: boolean; requestTimeoutMs?: number; file?: string } {
  const command = args[0];
  let name: string | undefined;
  let json = false;
  let noBrowser: boolean | undefined;
  let requestTimeoutMs: number | undefined;
  let reset = false;
  let file: string | undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      if (json) throw new Error("--json can only be supplied once");
      json = true;
    } else if (command === "auth" && arg === "--reset") {
      if (reset) throw new Error("--reset can only be supplied once");
      reset = true;
    } else if (command === "auth" && (arg === "--no-browser" || arg === "--browser" || arg.startsWith("--browser="))) {
      if (noBrowser !== undefined) throw new Error("Browser selection can only be supplied once");
      const mode = arg === "--no-browser" ? "none" : arg === "--browser" ? args[++index] : arg.slice("--browser=".length);
      if (mode !== "none" && mode !== "host") throw new Error("--browser requires none or host");
      noBrowser = mode === "none";
    } else if (command === "import" && (arg === "--file" || arg.startsWith("--file="))) {
      if (file !== undefined) throw new Error("--file can only be supplied once");
      file = arg === "--file" ? args[++index] : arg.slice("--file=".length);
      if (file === undefined || file === "") throw new Error("--file requires a virtual path or - for stdin");
    } else if (arg === "--timeout-ms" || arg.startsWith("--timeout-ms=")) {
      if (requestTimeoutMs !== undefined) throw new Error("--timeout-ms can only be supplied once");
      const value = arg === "--timeout-ms" ? args[++index] : arg.slice("--timeout-ms=".length);
      if (value === undefined || value.length === 0 || [...value].some(char => char < "0" || char > "9")) throw new Error("--timeout-ms requires a positive supported millisecond interval");
      requestTimeoutMs = Number(value);
      if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2_147_483_647) throw new Error("--timeout-ms requires a positive supported millisecond interval");
    } else if (arg === "--") {
      if (name !== undefined || index + 2 !== args.length) throw new Error(`${command} requires exactly one server name`);
      name = args[++index];
    } else {
      if (arg.startsWith("-") || name !== undefined) throw new Error(`Unknown ${command} argument '${arg}'`);
      name = arg;
    }
  }
  if (name === undefined) throw new Error(`${command} requires a server name`);
  return { name, json, reset, noBrowser, requestTimeoutMs, file };
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
  const authenticationUsage = `Usage: ${textLine(shellWord(name))} auth <server> [--json] [--browser none|host] [--reset]`;
  const authenticationGuidance = [
    "Auth verifies access without listing or calling tools. Headless login prints",
    "the complete authorization URL and exact redirect before waiting for consent.",
    "Keep this command running while opening the URL. --json emits one JSON record",
    "per authorization attempt. After URL output, connection status goes to stderr.",
    "--no-browser (default) never launches a browser; --browser host uses the",
    "host-configured opener. Cached credentials may connect without another URL.", "",
    "--reset retires saved OAuth tokens and registrations before new consent.",
    "--timeout-ms <milliseconds> bounds the complete authentication operation",
    "(default 120000). Host callback timeouts may impose a shorter limit."
  ];
  const authenticationHelp = [authenticationUsage, "", ...authenticationGuidance, "", "  --help  Show this help.", ""].join("\n");
  const resetHelp = [`Usage: ${textLine(shellWord(name))} reset <server> [--json] [--timeout-ms <milliseconds>]`, "",
    "Retire saved OAuth tokens and registrations for this name/profile.",
    "Reset needs no credential environment values or network connection. It can",
    "recover corrupt native records and withholds stale environment-token imports.",
    "Host-owned persistence requires a host reset hook. Update static bearer/header",
    "values in the host environment. The default lock wait is 30000 milliseconds.", "", "  --help  Show this help.", ""].join("\n");
  const resourceHelp = [`Usage: ${textLine(shellWord(name))} resource <server> [uri] [--cursor <value>] [--templates]`, "",
    "Without a URI, list one resource page; --templates lists URI templates.",
    "With a URI, read remote text/blob contents. URIs are sent to the MCP server.",
    "Complete results are JSON, including metadata and nextCursor; provide that",
    "cursor explicitly to request the next page. No tools are discovered or called.",
    "  --help  Show this help.", ""].join("\n");
  const importHelp = [`Usage: ${textLine(shellWord(name))} import <server> [--file <path>] [--json]`, "",
    "Read OAuth credential JSON from stdin (default) or a virtual --file path.",
    "Use --file - to select stdin explicitly.",
    "Keep tokens with their original app; full DCR clientInfo is preserved.",
    "Input: { \"tokens\": { \"access_token\": \"...\", \"token_type\": \"Bearer\" },",
    "         \"clientInfo\": { \"client_id\": \"original-app\" } }", "",
    "When clientInfo is absent, supply the original configured client ID/secret.",
    "OAuth metadata validates the issuer before client and grant are saved together.",
    "Import never initializes, lists or calls tools. Summaries contain no credentials.",
    "expires_in uses seconds; absolute expires_at uses epoch seconds and expiresAt",
    "uses epoch milliseconds. Optional top-level issuedAt uses epoch milliseconds",
    "for delayed imports. Absolute expiry wins over remaining relative lifetime.", "",
    "--timeout-ms <milliseconds> bounds input, discovery and persistence (default 30000).",
    "Host-owned persistence requires an atomic import hook. Input is bounded by",
    "the host input limit; malformed JSON is rejected without quoting credentials.", "", "  --help  Show this help.", ""].join("\n");
  const help = [
    `Usage: ${textLine(shellWord(name))} init [--format json|config|env]`,
    `       ${textLine(shellWord(name))} generate [--format json|config|module]`,
    `       ${textLine(shellWord(name))} auth <server> [--json] [--browser none|host] [--reset]`,
    `       ${textLine(shellWord(name))} reset <server> [--json]`,
    `       ${textLine(shellWord(name))} import <server> [--file <path>] [--json]`,
    `       ${textLine(shellWord(name))} resource <server> [uri] [--cursor <value>] [--templates]`, "",
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
    description: "Initialize, authenticate, import and generate remote MCP commands",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      const signal = factorySignal === undefined ? context.signal : AbortSignal.any([context.signal, factorySignal]);
      const operation = createOutputOperation({ signal, registerCleanup: context.registerCleanup }, context.stdout);
      const errors = operation.child(context.stderr);
      try {
        operation.signal.throwIfAborted();
        let output: string;
        let generationFormat: string | undefined;
        let authentication: ReturnType<typeof credentialArguments> | undefined;
        let credentialImport: ReturnType<typeof credentialArguments> | undefined;
        let credentialReset: ReturnType<typeof credentialArguments> | undefined;
        let resource: ReturnType<typeof resourceArguments> | undefined;
        try {
          const args = argumentText(context, maxInputBytes);
          if (args.length === 2 && args[0] === "auth" && args[1] === "--help") output = authenticationHelp;
          else if (args.length === 2 && args[0] === "import" && args[1] === "--help") output = importHelp;
          else if (args.length === 2 && args[0] === "reset" && args[1] === "--help") output = resetHelp;
          else if (args.length === 2 && args[0] === "resource" && args[1] === "--help") output = resourceHelp;
          else if (args.length === 0 || (args.length === 1 && args[0] === "--help") || (args.length === 2 && ["init", "generate"].includes(args[0]) && args[1] === "--help")) output = help;
          else if (args[0] === "resource") {
            const selected = resourceArguments(args, maxInputBytes);
            if (!initialization.configuration.servers.some(server => server.name === selected.name)) throw new Error(`Unknown remote MCP server '${selected.name}'`);
            resource = selected;
            output = "";
          }
          else if (args[0] === "auth" || args[0] === "reset" || args[0] === "import") {
            const selected = credentialArguments(args);
            if (!initialization.configuration.servers.some(server => server.name === selected.name)) throw new Error(`Unknown remote MCP server '${selected.name}'`);
            if (args[0] === "auth") authentication = selected;
            else if (args[0] === "import") credentialImport = selected;
            else credentialReset = selected;
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
        if (resource !== undefined) {
          const selected = resource;
          try {
            const settings = options.resources;
            const resourceSignal = settings?.signal;
            const signal = resourceSignal === undefined ? operation.signal : AbortSignal.any([operation.signal, resourceSignal]);
            signal.throwIfAborted();
            const server = initialization.configuration.servers.find(server => server.name === selected.name)!;
            const [bound] = bindRemoteMcpConfiguration({ version: 1, servers: [server] }, settings?.binding ?? { env: context.env });
            const result = await accessRemoteMcpResources(bound, selected.request, { ...settings, maxInputBytes: Math.min(maxInputBytes, settings?.maxInputBytes ?? maxInputBytes), signal });
            output = `${JSON.stringify(result)}\n`;
          } catch (error) {
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
            return { exitCode: 1 };
          }
        }
        if (credentialImport !== undefined) {
          const selected = credentialImport;
          const server = initialization.configuration.servers.find(server => server.name === selected.name)!;
          const settings = options.credentialImport;
          const importSignal = settings?.signal;
          const parentSignal = importSignal === undefined ? operation.signal : AbortSignal.any([operation.signal, importSignal]);
          let result: RemoteMcpCredentialImportResult;
          try {
            parentSignal.throwIfAborted();
            const requestTimeoutMs = selected.requestTimeoutMs ?? settings?.requestTimeoutMs ?? 30_000;
            if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2_147_483_647)
              throw new Error("Import requestTimeoutMs must be a positive supported timer interval");
            const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(requestTimeoutMs)]);
            const file = selected.file;
            let source = context.stdin;
            if (file !== undefined && file !== "-") {
              const path = posix.resolve(context.cwd, file);
              source = context.fs.readStream === undefined
                ? toByteSource(await context.fs.readFile(path, { signal, maxBytes: maxInputBytes }))
                : context.fs.readStream(path, { signal });
            }
            const bytes = await collectBytes(source, { signal, maxBytes: maxInputBytes });
            let json: string;
            try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
            catch { throw new Error("OAuth credential input must be valid UTF-8"); }
            result = await importRemoteMcpAuthentication(server, json, {
              ...options, ...settings, binding: settings?.binding ?? options.authentication?.binding ?? { env: context.env },
              fetch: settings?.fetch ?? options.authentication?.fetch,
              requestTimeoutMs,
              maxImportBytes: settings?.maxImportBytes ?? maxInputBytes, signal
            });
          } catch (error) {
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
            return { exitCode: 1 };
          }
          await emit(operation, selected.json ? `${JSON.stringify(result)}\n` : `Imported OAuth credentials for ${textLine(shellWord(result.name))}.\n`, maxOutputBytes);
          return { exitCode: 0 };
        }
        if (credentialReset !== undefined) {
          const selected = credentialReset;
          const server = initialization.configuration.servers.find(server => server.name === selected.name)!;
          const settings = options.reset;
          const resetSignal = settings?.signal;
          let result: RemoteMcpCredentialResetResult;
          try {
            result = await resetRemoteMcpAuthentication(server, {
              ...options, ...settings, binding: settings?.binding ?? options.authentication?.binding,
              timeoutMs: selected.requestTimeoutMs ?? settings?.timeoutMs,
              signal: resetSignal === undefined ? operation.signal : AbortSignal.any([operation.signal, resetSignal])
            });
          } catch (error) {
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, maxOutputBytes);
            return { exitCode: 1 };
          }
          await emit(operation, selected.json ? `${JSON.stringify(result)}\n` : `Reset OAuth credentials for ${textLine(shellWord(result.name))}.\n`, maxOutputBytes);
          return { exitCode: 0 };
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
              reset: selected.reset || settings?.reset,
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
