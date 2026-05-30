import type { SpawnEvent, SpawnUsage } from "../../types.js";
import type {
  NormalizedTrace,
  NormalizedTraceEvent,
  TraceTimestamp,
  TraceToolEvent,
  TraceToolOperation,
  TraceToolOutcome
} from "./types.js";

type StartedTool = Pick<
  TraceToolEvent,
  "id" | "name" | "operation" | "rawArguments" | "paths" | "inspection"
>;

const ARGUMENT_PATH_KEYS = ["path", "filePath", "file_path"] as const;
const COMMAND_DIRECTORY_KEYS = ["cwd", "workdir", "workingDirectory", "working_directory"] as const;

export function normalizeTrace(events: readonly SpawnEvent[]): NormalizedTrace {
  const normalizer = createTraceNormalizer();
  for (const event of events) {
    normalizer.record(event);
  }
  return normalizer.snapshot();
}

export function createTraceNormalizer(): {
  record(event: SpawnEvent): NormalizedTraceEvent | undefined;
  snapshot(): NormalizedTrace;
} {
  const normalizedEvents: NormalizedTraceEvent[] = [];
  const tools = new Map<string, StartedTool>();
  const usage: SpawnUsage = { inputTokens: 0, outputTokens: 0 };
  let sequence = 0;

  return {
    record(event) {
      const normalized = normalizeEvent(event, sequence, tools);
      sequence += 1;
      if (normalized === undefined) {
        return undefined;
      }
      normalizedEvents.push(normalized);
      if (normalized.type === "usage") {
        addUsage(usage, normalized.usage);
      }
      return normalized;
    },
    snapshot() {
      return { events: normalizedEvents.slice(), usage: { ...usage } };
    }
  };
}

function normalizeEvent(
  event: SpawnEvent,
  sequence: number,
  tools: Map<string, StartedTool>
): NormalizedTraceEvent | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const timestamp = readTimestamp(event);
  const message = normalizeMessage(event, sequence, timestamp);
  if (message !== undefined) {
    return message;
  }

  const tool = normalizeTool(event, sequence, timestamp, tools);
  if (tool !== undefined) {
    return tool;
  }

  const usage = normalizeUsage(event, sequence, timestamp);
  if (usage !== undefined) {
    return usage;
  }

  if (event.event === "error") {
    const errorMessage = readString(event.message);
    return errorMessage === undefined
      ? undefined
      : { type: "error", sequence, message: errorMessage, ...optionalTimestamp(timestamp) };
  }

  return undefined;
}

function normalizeMessage(
  event: Record<string, unknown>,
  sequence: number,
  timestamp: TraceTimestamp | undefined
): NormalizedTraceEvent | undefined {
  if (event.event === "agent_message") {
    const text = readString(event.text);
    return text === undefined
      ? undefined
      : { type: "message", sequence, text, ...optionalTimestamp(timestamp) };
  }
  if (event.event === "reasoning") {
    const text = readString(event.text);
    return text === undefined
      ? undefined
      : { type: "message", sequence, text, channel: "reasoning", ...optionalTimestamp(timestamp) };
  }
  if (event.sessionUpdate === "agent_message_chunk") {
    const content = isRecord(event.content) ? readString(event.content.text) : undefined;
    return content === undefined
      ? undefined
      : { type: "message", sequence, text: content, ...optionalTimestamp(timestamp) };
  }
  if (event.sessionUpdate === "agent_thought_chunk") {
    const content = isRecord(event.content) ? readString(event.content.text) : undefined;
    return content === undefined
      ? undefined
      : {
          type: "message",
          sequence,
          text: content,
          channel: "reasoning",
          ...optionalTimestamp(timestamp)
        };
  }
  return undefined;
}

function normalizeTool(
  event: Record<string, unknown>,
  sequence: number,
  timestamp: TraceTimestamp | undefined,
  tools: Map<string, StartedTool>
): TraceToolEvent | undefined {
  if (event.event === "tool_start" || event.sessionUpdate === "tool_call") {
    const isSessionTool = event.sessionUpdate === "tool_call";
    const id = readString(event.id) ?? readString(event.toolCallId);
    const name = readString(event.title);
    const kind = readString(event.kind);
    if (
      name === undefined ||
      (isSessionTool && id === undefined) ||
      (!isSessionTool && kind === undefined)
    ) {
      return undefined;
    }
    const operation = normalizeToolOperation(kind, name);
    const rawArguments = event.rawInput ?? event.input;
    const paths = readPaths(event, rawArguments, operation, kind, name);
    const inspection = readInspection(rawArguments, operation, name, paths);
    const outcome = isSessionTool ? readOutcome(event.status) : undefined;
    const start: TraceToolEvent = {
      type: "tool",
      sequence,
      phase: outcome === undefined ? "start" : "complete",
      ...(id === undefined ? {} : { id }),
      name,
      operation,
      ...(rawArguments === undefined ? {} : { rawArguments }),
      ...(event.rawOutput === undefined ? {} : { rawOutput: event.rawOutput }),
      paths,
      ...(inspection === undefined ? {} : { inspection }),
      ...(outcome === undefined ? {} : { outcome }),
      ...optionalTimestamp(timestamp)
    };
    if (id !== undefined && outcome === undefined) {
      tools.set(id, start);
    }
    return start;
  }

  if (event.event !== "tool_complete" && event.sessionUpdate !== "tool_call_update") {
    return undefined;
  }

  const id = readString(event.id) ?? readString(event.toolCallId);
  if (event.sessionUpdate === "tool_call_update" && id === undefined) {
    return undefined;
  }
  const started = id === undefined ? undefined : tools.get(id);
  const status =
    readOutcome(event.status) ?? (event.event === "tool_complete" ? "completed" : undefined);
  if (status === undefined) {
    return undefined;
  }
  if (id !== undefined) {
    tools.delete(id);
  }
  const operation =
    started?.operation ?? normalizeToolOperation(readString(event.kind), readString(event.title));
  const name = started?.name ?? readString(event.title) ?? id ?? operation;
  const rawArguments = started?.rawArguments ?? event.rawInput ?? event.input;
  const paths = mergePaths(
    started?.paths ?? [],
    readPaths(
      event,
      rawArguments,
      operation,
      readString(event.kind),
      name,
      started === undefined && operation !== "exec" && operation !== "mcp"
    )
  );
  const inspection = readInspection(rawArguments, operation, name, paths);
  return {
    type: "tool",
    sequence,
    phase: "complete",
    ...(id === undefined ? {} : { id }),
    name,
    operation,
    ...(rawArguments === undefined ? {} : { rawArguments }),
    ...(event.rawOutput === undefined ? {} : { rawOutput: event.rawOutput }),
    paths,
    ...(inspection === undefined ? {} : { inspection }),
    outcome: status,
    ...optionalTimestamp(timestamp)
  };
}

function normalizeUsage(
  event: Record<string, unknown>,
  sequence: number,
  timestamp: TraceTimestamp | undefined
): NormalizedTraceEvent | undefined {
  if (event.event === "usage") {
    const inputTokens = readNumber(event.inputTokens);
    const outputTokens = readNumber(event.outputTokens);
    if (inputTokens === undefined || outputTokens === undefined) {
      return undefined;
    }
    return {
      type: "usage",
      sequence,
      usage: createUsage(inputTokens, outputTokens, event.cachedTokens, event.costUsd),
      ...optionalTimestamp(timestamp)
    };
  }
  if (event.sessionUpdate !== "usage_update") {
    return undefined;
  }
  const used = readNumber(event.used);
  const size = readNumber(event.size);
  if (used === undefined || size === undefined) {
    return undefined;
  }
  const meta = isRecord(event._meta) ? event._meta : {};
  const costUsd =
    isRecord(event.cost) && event.cost.currency === "USD" ? event.cost.amount : undefined;
  return {
    type: "usage",
    sequence,
    usage: createUsage(
      readNumber(meta.inputTokens) ?? used,
      readNumber(meta.outputTokens) ?? 0,
      readNumber(meta.cachedTokens) ?? Math.max(0, size - used),
      costUsd
    ),
    ...optionalTimestamp(timestamp)
  };
}

function normalizeToolOperation(kind: string | undefined, name?: string): TraceToolOperation {
  switch (kind?.toLowerCase()) {
    case "read":
      return "read";
    case "search":
    case "glob":
    case "grep":
      return "search";
    case "execute":
    case "exec":
    case "command":
    case "shell":
      return "exec";
    case "edit":
    case "patch":
      return "edit";
    case "write":
      return "write";
    case "mcp":
    case "mcp_tool_call":
      return "mcp";
    default:
      return kind === "other" && isMcpToolName(name) ? "mcp" : "other";
  }
}

function isMcpToolName(name: string | undefined): boolean {
  return name?.includes(".") === true || name?.startsWith("mcp__") === true;
}

function readPaths(
  event: Record<string, unknown>,
  rawArguments: unknown,
  operation: TraceToolOperation,
  kind: string | undefined,
  name?: string,
  trustTerminalPath = false
): readonly string[] {
  const paths: string[] = [];
  if (event.event === "tool_start" || trustTerminalPath) {
    addUnique(paths, readString(event.path));
  }
  if (Array.isArray(event.locations)) {
    for (const location of event.locations) {
      if (isRecord(location)) {
        addUnique(paths, readString(location.path));
      }
    }
  }
  if (isRecord(rawArguments)) {
    for (const key of ARGUMENT_PATH_KEYS) {
      addUnique(paths, readString(rawArguments[key]));
    }
    if (operation === "search" && kind?.toLowerCase() === "glob") {
      addUnique(paths, readString(rawArguments.pattern));
    }
    if (operation === "exec") {
      for (const key of COMMAND_DIRECTORY_KEYS) {
        addUnique(paths, readString(rawArguments[key]));
      }
      if (Array.isArray(rawArguments.args) && !isShellScriptInvocation(rawArguments)) {
        for (const argument of rawArguments.args) {
          const value = readString(argument);
          addUnique(paths, value !== undefined && resemblesPath(value) ? value : undefined);
        }
      }
    }
  }
  if (paths.length === 0 && operation !== "exec" && operation !== "mcp") {
    addUnique(paths, name !== undefined && resemblesPath(name) ? name : undefined);
  }
  return paths;
}

function readInspection(
  rawArguments: unknown,
  operation: TraceToolOperation,
  name: string,
  paths: readonly string[]
): TraceToolEvent["inspection"] | undefined {
  if (operation === "exec") {
    if (isRecord(rawArguments) && hasUninspectableShellScriptEvidence(rawArguments)) {
      return { status: "uninspectable", reason: "shell-command" };
    }
    const command = isRecord(rawArguments) ? readString(rawArguments.command) : name;
    if (command !== undefined && hasUninspectableShellEvidence(command)) {
      return { status: "uninspectable", reason: "shell-command" };
    }
    return undefined;
  }
  if (paths.length === 0 && isPathRequiredOperation(operation, name)) {
    return { status: "uninspectable", reason: "missing-path" };
  }
  return undefined;
}

function isPathRequiredOperation(operation: TraceToolOperation, name: string): boolean {
  if (operation !== "mcp") {
    return (
      operation === "read" ||
      operation === "search" ||
      operation === "edit" ||
      operation === "write"
    );
  }
  const normalized = name.toLowerCase();
  return (
    normalized.includes("read") ||
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("file") ||
    normalized.includes("glob") ||
    normalized.includes("search")
  );
}

function isShellScriptInvocation(rawArguments: Record<string, unknown>): boolean {
  const command = readString(rawArguments.command);
  const args = rawArguments.args;
  if (command === undefined || !Array.isArray(args)) {
    return false;
  }
  const executable = command.split("/").at(-1);
  if (isShellExecutable(executable)) {
    return args.some((argument) => argument === "-c");
  }
  return args.some(
    (argument, index) =>
      typeof argument === "string" &&
      isShellExecutable(argument.split("/").at(-1)) &&
      args[index + 1] === "-c"
  );
}

function hasUninspectableShellScriptEvidence(rawArguments: Record<string, unknown>): boolean {
  if (!isShellScriptInvocation(rawArguments) || !Array.isArray(rawArguments.args)) {
    return false;
  }
  const commandIndex = rawArguments.args.indexOf("-c") + 1;
  const script = readString(rawArguments.args[commandIndex]);
  return script !== undefined && hasUninspectableShellEvidence(script);
}

function isShellExecutable(executable: string | undefined): boolean {
  return executable === "sh" || executable === "bash" || executable === "zsh";
}

function hasUninspectableShellEvidence(command: string): boolean {
  if (command.includes(">") || command.includes("<")) {
    return true;
  }
  const tokens = command.split(" ").filter((token) => token.length > 0);
  return tokens.slice(1).some((token) => resemblesPath(token));
}

function resemblesPath(value: string): boolean {
  if (value.includes("://")) {
    return false;
  }
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function mergePaths(first: readonly string[], second: readonly string[]): readonly string[] {
  const paths = [...first];
  for (const value of second) {
    addUnique(paths, value);
  }
  return paths;
}

function createUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokensValue: unknown,
  costUsdValue: unknown
): SpawnUsage {
  const cachedTokens = readNumber(cachedTokensValue);
  const costUsd = readNumber(costUsdValue);
  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(costUsd === undefined ? {} : { costUsd })
  };
}

function addUsage(total: SpawnUsage, usage: SpawnUsage): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  if (usage.cachedTokens !== undefined) {
    total.cachedTokens = (total.cachedTokens ?? 0) + usage.cachedTokens;
  }
  if (usage.costUsd !== undefined) {
    total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
  }
}

function readOutcome(value: unknown): TraceToolOutcome | undefined {
  return value === "completed" || value === "failed" || value === "cancelled" ? value : undefined;
}

function readTimestamp(event: Record<string, unknown>): TraceTimestamp | undefined {
  const timestamp = event.timestamp ?? (isRecord(event._meta) ? event._meta.timestamp : undefined);
  return typeof timestamp === "string" || typeof timestamp === "number" ? timestamp : undefined;
}

function optionalTimestamp(timestamp: TraceTimestamp | undefined): { timestamp?: TraceTimestamp } {
  return timestamp === undefined ? {} : { timestamp };
}

function addUnique(values: string[], value: string | undefined): void {
  if (value !== undefined && !values.includes(value)) {
    values.push(value);
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
