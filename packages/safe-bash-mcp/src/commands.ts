import {
  collectBytes, commandRuntimeIdentity, createOutputOperation, getCommandArguments,
  type CommandContext, type CommandDefinition, type OutputOperation, type VirtualShellPlugin
} from "@poe-platform/safe-bash/contracts";
import { OAuthError } from "mcp-oauth";
import { HttpTransportError, McpError, type Tool, type CallToolResult } from "tiny-mcp-client";
import { compileJsonSchema, formatIssues, type CompiledJsonSchema, type CompileJsonSchemaOptions } from "toolcraft-schema";
import { compileToolArguments, type ToolArgumentParseOptions, type ToolArgumentParser } from "./arguments.js";
import { withRemoteMcpClient } from "./remote.js";
import { resolveRemoteMcpSchemas, snapshotRemoteMcpServer, type RemoteMcpServer, type SchemaFetchOptions } from "./schema.js";

export interface RemoteMcpCommandOptions extends SchemaFetchOptions, ToolArgumentParseOptions {
  readonly maxOutputBytes?: number;
  readonly schemaValidation?: CompileJsonSchemaOptions;
}

export function commandLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function positiveArgument(value: string | undefined, flag: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined || value.length === 0 || [...value].some(char => char < "0" || char > "9"))
    throw new Error(`${flag} requires a positive integer no greater than ${maximum}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    throw new Error(`${flag} requires a positive integer no greater than ${maximum}`);
  return result;
}

const executionFlags = {
  "--timeout-ms": "requestTimeoutMs", "--max-response-bytes": "maxResponseBytes",
  "--max-input-bytes": "maxInputBytes", "--max-output-bytes": "maxOutputBytes"
} as const;
type ExecutionPolicy = Partial<Record<typeof executionFlags[keyof typeof executionFlags], number>>;

const executionHelp = ["Execution options (before the tool name):",
  "  --timeout-ms <milliseconds>  Override the request deadline.",
  "  --max-response-bytes <bytes> Override the HTTP response limit.",
  "  --max-input-bytes <bytes>    Limit input within the host ceiling.",
  "  --max-output-bytes <bytes>   Limit output within the host ceiling.",
  "Use -- before a literal tool name beginning with a dash.", ""];

function executionArguments(args: readonly string[]): { index: number; policy: ExecutionPolicy } {
  const policy: ExecutionPolicy = {};
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index], flag = arg.split("=", 1)[0];
    if (!Object.hasOwn(executionFlags, flag)) break;
    const key = executionFlags[flag as keyof typeof executionFlags];
    if (policy[key] !== undefined) throw new Error(`${flag} can only be supplied once`);
    policy[key] = positiveArgument(arg === flag ? args[++index] : arg.slice(flag.length + 1), flag,
      key === "requestTimeoutMs" ? 2_147_483_647 : Number.MAX_SAFE_INTEGER);
  }
  return { index, policy };
}

export function validateCommandName(name: string): void {
  if (typeof name !== "string" || name.length === 0 || [...name].some(char => char === "/" || char === "\0" || char.trim() === ""))
    throw new Error("Remote MCP command name must be nonempty and contain no whitespace, slash or NUL");
}

export function textLine(text: string): string {
  let line = "";
  for (const char of text) {
    if (char === "\n" || char === "\r") break;
    const code = char.codePointAt(0)!;
    line += code < 32 || (code >= 127 && code <= 159) ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return line;
}

export function shellWord(word: string): string {
  return [...word].every(char => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-".includes(char)) && word.length > 0
    ? word : `'${word.split("'").join("'\\''")}'`;
}

function instructionLines(instructions?: string): string[] {
  return instructions === undefined || instructions === "" ? []
    : ["Instructions:", ...instructions.split("\r\n").join("\n").split("\r").join("\n").split("\n").map(textLine), ""];
}

function toolHelp(name: string, parser: ToolArgumentParser, description?: string, instructions?: string): string {
  const prefix = `${shellWord(name)} [execution options] ${parser.toolName.startsWith("-") ? "-- " : ""}${shellWord(parser.toolName)}`;
  const lines = [`Usage: ${textLine(prefix)} [arguments]`, "", ...(description ? [textLine(description), ""] : []), ...instructionLines(instructions), ...executionHelp, "Arguments:"];
  for (const parameter of parser.parameters)
    lines.push(`  ${parameter.flag} <value>${parameter.required ? " (required)" : ""}${parameter.description ? `  ${textLine(parameter.description)}` : ""}`);
  lines.push("", "  --raw <json>  Provide a complete JSON object; use - to read stdin.",
    "  --yes         Accept schema defaults.", "  --help        Show tool help.", "  --schema      Print complete tool metadata as JSON without calling it.",
    "", "Arrays accept JSON arrays, repeated flags or JSON item sequences.");
  return `${lines.join("\n")}\n`;
}

interface PreparedTool {
  readonly tool: Tool;
  readonly parser: ToolArgumentParser;
  readonly output?: CompiledJsonSchema;
}

function toolInspection(args: readonly string[]): "help" | "schema" | undefined {
  let inspection: "schema" | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--raw") { index++; continue; }
    if (args[index] === "--help") return "help";
    if (args[index] === "--schema") inspection = "schema";
  }
  return inspection;
}

const publicOAuthErrorCodes = new Set([
  "invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope",
  "invalid_token", "insufficient_scope", "access_denied", "unsupported_response_type", "server_error", "temporarily_unavailable",
  "interaction_required", "login_required", "consent_required", "account_selection_required", "invalid_redirect_uri",
  "invalid_client_metadata", "invalid_software_statement", "unapproved_software_statement", "invalid_target", "invalid_response"
]);

export function errorDetails(error: unknown, seen = new Set<unknown>(), depth = 0): Record<string, unknown> {
  if (depth > 8 || seen.has(error)) return { message: "Nested error details omitted" };
  seen.add(error);
  if (error instanceof OAuthError) {
    const code = publicOAuthErrorCodes.has(error.error) ? error.error : undefined;
    return { name: "OAuthError", message: code === undefined ? `OAuth request failed (HTTP ${error.status})` : `OAuth ${code} (HTTP ${error.status})`,
      status: error.status, ...(code === undefined ? {} : { oauthError: code }),
      retryable: error.retryable, terminal: error.terminal, outcomeKnown: error.outcomeKnown };
  }
  const details: Record<string, unknown> = {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : typeof error === "string" ? error : "Remote MCP operation failed"
  };
  if (error instanceof McpError) {
    details.code = error.code;
    if (Object.hasOwn(error, "data")) details.data = error.data;
  }
  if (error instanceof HttpTransportError) {
    details.status = error.status; details.method = error.method;
    if (error.rpcMethod !== undefined) details.rpcMethod = error.rpcMethod;
  }
  if (error instanceof Error && error.cause !== undefined) details.cause = errorDetails(error.cause, seen, depth + 1);
  if (error instanceof AggregateError) details.errors = error.errors.map(value => errorDetails(value, new Set(seen), depth + 1));
  return details;
}

class CommandOutputLimitError extends Error {}

export async function emit(operation: OutputOperation, text: string, maxBytes: number): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new CommandOutputLimitError("MCP command output byte limit exceeded");
  const bytes = new TextEncoder().encode(text);
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    operation.signal.throwIfAborted();
    await operation.output.write(bytes.subarray(offset, offset + 16 * 1024));
  }
}

export function argumentText(context: CommandContext, maxBytes: number): string[] {
  const carrier = getCommandArguments(context);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  return carrier.args.map((_arg, index) => {
    const value = carrier.bytes(index)!;
    bytes += value.byteLength;
    if (bytes > maxBytes) throw new Error("MCP argument byte limit exceeded");
    try { return decoder.decode(value); }
    catch (cause) { throw new Error("MCP arguments must be valid UTF-8", { cause }); }
  });
}

async function stdinArguments(context: CommandContext, args: readonly string[], signal: AbortSignal, maxBytes: number): Promise<readonly string[]> {
  const meaningful = args.filter(arg => arg !== "--yes");
  const inline = meaningful.length === 1 && meaningful[0] === "--raw=-";
  const separated = meaningful.length === 2 && meaningful[0] === "--raw" && meaningful[1] === "-";
  if (!inline && !separated) return args;
  const bytes = await collectBytes(context.stdin, { signal, maxBytes });
  let json: string;
  try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (cause) { throw new Error("MCP JSON stdin must be valid UTF-8", { cause }); }
  const normalized = [...args];
  const index = normalized.indexOf(inline ? "--raw=-" : "--raw");
  normalized[inline ? index : index + 1] = inline ? `--raw=${json}` : json;
  return normalized;
}

/** Generate a safe-bash command for each server, discovering only absent schemas. */
export async function createRemoteMcpCommands(
  servers: readonly RemoteMcpServer[],
  options: RemoteMcpCommandOptions = {}
): Promise<CommandDefinition[]> {
  const maxInputBytes = commandLimit(options.maxInputBytes ?? 1024 * 1024, "maxInputBytes");
  const maxOutputBytes = commandLimit(options.maxOutputBytes ?? 16 * 1024 * 1024, "maxOutputBytes");
  for (const server of servers) validateCommandName(server.name);
  const settings = {
    ...options,
    schemaValidation: {
      ...options.schemaValidation,
      ...(options.schemaValidation?.registry === undefined ? {} : { registry: structuredClone(options.schemaValidation.registry) }),
      ...(options.schemaValidation?.formats === undefined ? {} : { formats: { ...options.schemaValidation.formats } })
    }
  };
  const snapshots = servers.map(snapshotRemoteMcpServer);
  const schemas = await resolveRemoteMcpSchemas(snapshots, settings);
  return schemas.map((schema, index) => {
    const server: RemoteMcpServer = { ...snapshots[index], tools: schema.tools };
    const tools = new Map<string, PreparedTool>(schema.tools.map(tool => [tool.name, {
      tool, parser: compileToolArguments(tool, settings.schemaValidation),
      output: tool.outputSchema === undefined ? undefined : compileJsonSchema(structuredClone(tool.outputSchema), settings.schemaValidation)
    }]));
    const summary = [`Usage: ${textLine(shellWord(server.name))} [execution options] <tool> [arguments]`, "", ...instructionLines(schema.instructions), ...executionHelp, "Tools:",
      ...[...tools.values()].map(({ tool }) => `  ${textLine(shellWord(tool.name))}${tool.description ? `  ${textLine(tool.description)}` : ""}`),
      ...(tools.size === 0 ? ["  No tools advertised."] : []), "", `Run ${textLine(shellWord(server.name))} <tool> --help for arguments or --schema for JSON metadata.`].join("\n") + "\n";
    return {
      name: server.name,
      description: `Remote MCP tools for ${server.name}`,
      runtimeIdentity: commandRuntimeIdentity,
      async execute(context) {
        const signal = settings.signal === undefined ? context.signal : AbortSignal.any([context.signal, settings.signal]);
        const operation = createOutputOperation({ signal, registerCleanup: context.registerCleanup }, context.stdout);
        const errors = operation.child(context.stderr);
        let outputLimit = maxOutputBytes;
        try {
          operation.signal.throwIfAborted();
          let entry: PreparedTool | undefined;
          let argumentsValue: Record<string, unknown> | undefined;
          let help: string | undefined;
          let policy: ExecutionPolicy = {};
          let inputLimit = maxInputBytes;
          try {
            const args = argumentText(context, maxInputBytes);
            const execution = executionArguments(args);
            policy = execution.policy;
            inputLimit = Math.min(maxInputBytes, policy.maxInputBytes ?? maxInputBytes);
            outputLimit = Math.min(maxOutputBytes, policy.maxOutputBytes ?? maxOutputBytes);
            if (args.reduce((bytes, arg) => bytes + Buffer.byteLength(arg, "utf8"), 0) > inputLimit)
              throw new Error("MCP argument byte limit exceeded");
            if (execution.index === args.length || args[execution.index] === "--help") {
              help = summary;
            } else {
              const literal = args[execution.index] === "--";
              const name = args[execution.index + (literal ? 1 : 0)];
              const selected = tools.get(name);
              if (!selected) throw new Error(`Unknown MCP tool '${name ?? ""}'`);
              entry = selected;
              const inputs = args.slice(execution.index + (literal ? 2 : 1));
              const inspection = toolInspection(inputs);
              if (inspection !== undefined) {
                help = inspection === "help" ? toolHelp(server.name, entry.parser, entry.tool.description, schema.instructions)
                  : `${JSON.stringify(entry.tool)}\n`;
              } else argumentsValue = entry.parser.parse(await stdinArguments(context, inputs, operation.signal, inputLimit), {
                yes: settings.yes, maxInputBytes: inputLimit
              });
            }
          } catch (error) {
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, outputLimit);
            return { exitCode: 2 };
          }
          if (help !== undefined) {
            await emit(operation, help, outputLimit);
            return { exitCode: 0 };
          }
          const selected = entry!;
          let result: CallToolResult;
          try {
            result = await withRemoteMcpClient(server, { ...settings, ...policy, signal: operation.signal },
              client => client.callTool({ name: selected.tool.name, arguments: argumentsValue }, { signal: operation.signal }));
          } catch (error) {
            operation.signal.throwIfAborted();
            await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, outputLimit);
            return { exitCode: 1 };
          }
          await emit(operation, `${JSON.stringify(result)}\n`, outputLimit);
          if (result.isError) return { exitCode: 1 };
          if (selected.output) {
            const validation = selected.output.validate(result.structuredContent);
            if (!validation.ok) {
              await emit(errors, `${JSON.stringify({ error: { message: `Invalid tool output: ${formatIssues(validation.issues)}` } })}\n`, outputLimit);
              return { exitCode: 1 };
            }
          }
          return { exitCode: 0 };
        } catch (error) {
          operation.signal.throwIfAborted();
          if (!(error instanceof CommandOutputLimitError)) throw error;
          await emit(errors, `${JSON.stringify({ error: errorDetails(error) })}\n`, outputLimit);
          return { exitCode: 1 };
        } finally { await operation.close(); }
      }
    };
  });
}

/** Register generated commands after checking all conflicts, avoiding partial setup. */
export async function remoteMcpCommands(servers: readonly RemoteMcpServer[], options: RemoteMcpCommandOptions = {}): Promise<VirtualShellPlugin> {
  const definitions = await createRemoteMcpCommands(servers, options);
  return {
    name: "remote-mcp-commands",
    setup(host) {
      for (const definition of definitions) if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      for (const definition of definitions) host.commands.register(definition);
    }
  };
}
