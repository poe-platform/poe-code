import path from "node:path";
import { asRecord, newestDate, parseDate, parseJsonLines } from "../line-json.js";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  NormalizedTraceTurn,
  TraceReader,
  TraceReference,
  TraceUsage
} from "../types.js";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function listDirectory(fs: AgentTraceFileSystem, directory: string): Promise<string[]> {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

async function listSessionDirectories(
  fs: AgentTraceFileSystem,
  sessionsRoot: string
): Promise<string[]> {
  const directories: string[] = [];
  for (const name of (await listDirectory(fs, sessionsRoot)).sort()) {
    const candidate = path.join(sessionsRoot, name);
    try {
      if ((await fs.stat(candidate)).isDirectory()) {
        directories.push(candidate);
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }
  return directories;
}

async function listJsonlFiles(fs: AgentTraceFileSystem, directory: string): Promise<string[]> {
  return (await listDirectory(fs, directory))
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(directory, name));
}

function encodeWorkspacePath(cwd: string): string {
  return `--${cwd
    .split(path.sep)
    .filter((part) => part.length > 0)
    .join("-")}--`;
}

function fileId(filePath: string): string {
  const name = path.basename(filePath);
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
}

function textParts(content: unknown): string[] {
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? [text] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      if (item.trim().length > 0) {
        parts.push(item.trim());
      }
      continue;
    }
    const record = asRecord(item);
    if (
      record?.type === "text" &&
      typeof record.text === "string" &&
      record.text.trim().length > 0
    ) {
      parts.push(record.text.trim());
    }
  }
  return parts;
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const text = JSON.stringify(value);
  return text ?? "";
}

function mcpServerFromToolName(toolName: string): string | undefined {
  if (!toolName.startsWith("mcp__")) {
    return undefined;
  }
  const server = toolName.split("__")[1];
  return server && server.length > 0 ? server : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageFromMessage(message: Record<string, unknown>): TraceUsage | undefined {
  const usage = asRecord(message.usage);
  if (!usage) {
    return undefined;
  }
  const inputTokens = tokenCount(usage.input) ?? 0;
  const outputTokens = tokenCount(usage.output) ?? 0;
  const cachedTokens = tokenCount(usage.cacheRead) ?? 0;
  const cacheCreationTokens = tokenCount(usage.cacheWrite) ?? 0;
  const contextTokens = tokenCount(usage.totalTokens) ?? inputTokens + cachedTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheCreationTokens,
    contextTokens,
    source: "reported"
  };
}

function baseTurn(record: Record<string, unknown>, message: Record<string, unknown>) {
  const timestamp = parseDate(record.timestamp) ?? parseDate(message.timestamp);
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(timestamp ? { timestamp } : {})
  };
}

function turnsFromMessage(
  record: Record<string, unknown>,
  toolCalls: Map<string, string>
): NormalizedTraceTurn[] {
  if (record.type !== "message") {
    return [];
  }
  const message = asRecord(record.message);
  if (!message) {
    return [];
  }
  const base = baseTurn(record, message);

  if (message.role === "user") {
    return textParts(message.content).map((text) => ({
      ...base,
      role: "human",
      text,
      sourceKind: "user_message"
    }));
  }

  if (message.role === "toolResult") {
    const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    const toolName =
      typeof message.toolName === "string"
        ? message.toolName
        : toolCallId
          ? toolCalls.get(toolCallId)
          : undefined;
    const text = textParts(message.content).join("\n");
    if (text.length === 0) {
      return [];
    }
    return [
      {
        ...base,
        role: "tool",
        text,
        sourceKind: "tool_result",
        ...(toolName ? { toolName } : {}),
        ...(toolName ? { mcpServer: mcpServerFromToolName(toolName) } : {})
      }
    ];
  }

  if (message.role !== "assistant") {
    return [];
  }

  const turns: NormalizedTraceTurn[] = [];
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      const content = asRecord(item);
      if (!content) {
        continue;
      }
      if (
        content.type === "thinking" &&
        typeof content.thinking === "string" &&
        content.thinking.trim().length > 0
      ) {
        turns.push({
          ...base,
          role: "assistant",
          text: content.thinking.trim(),
          sourceKind: "reasoning"
        });
        continue;
      }
      if (
        content.type === "text" &&
        typeof content.text === "string" &&
        content.text.trim().length > 0
      ) {
        turns.push({
          ...base,
          role: "assistant",
          text: content.text.trim(),
          sourceKind: "assistant_message"
        });
        continue;
      }
      if (content.type !== "toolCall" || typeof content.name !== "string") {
        continue;
      }
      if (typeof content.id === "string") {
        toolCalls.set(content.id, content.name);
      }
      turns.push({
        ...base,
        role: "tool",
        text: stringify(content.arguments),
        sourceKind: "tool_use",
        toolName: content.name,
        ...(mcpServerFromToolName(content.name)
          ? { mcpServer: mcpServerFromToolName(content.name) }
          : {})
      });
    }
  }

  if (typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0) {
    turns.push({
      ...base,
      role: "assistant",
      text: message.errorMessage.trim(),
      sourceKind: "error"
    });
  }
  return turns;
}

function readTraceContents(filePath: string, contents: string): NormalizedTrace {
  let id = fileId(filePath);
  let cwd: string | undefined;
  let model: string | undefined;
  let title: string | undefined;
  let usage: TraceUsage | undefined;
  let createdAt: Date | undefined;
  let updatedAt: Date | undefined;
  const turns: NormalizedTraceTurn[] = [];
  const toolCalls = new Map<string, string>();

  for (const value of parseJsonLines(contents)) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }
    const recordTimestamp = parseDate(record.timestamp);
    createdAt = createdAt ?? recordTimestamp;
    updatedAt = newestDate(updatedAt, recordTimestamp);

    if (record.type === "session") {
      if (typeof record.id === "string") {
        id = record.id;
      }
      if (typeof record.cwd === "string") {
        cwd = record.cwd;
      }
    }
    if (record.type === "model_change" && typeof record.modelId === "string") {
      model = record.modelId;
    }

    const message = asRecord(record.message);
    if (message?.role === "assistant") {
      if (typeof message.model === "string") {
        model = message.model;
      }
      usage = usageFromMessage(message) ?? usage;
    }

    const messageTurns = turnsFromMessage(record, toolCalls);
    if (title === undefined) {
      title = messageTurns.find((turn) => turn.role === "human")?.text;
    }
    turns.push(...messageTurns);
  }

  return {
    source: "pi",
    id,
    path: filePath,
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    turns
  };
}

export const piTraceReader: TraceReader = {
  id: "pi",
  defaultRoots(homeDir: string): string[] {
    return [path.join(homeDir, ".pi", "agent", "sessions")];
  },
  async discover(options): Promise<TraceReference[]> {
    const sessionsRoot = path.join(options.homeDir, ".pi", "agent", "sessions");
    const directories =
      options.allWorkspaces || !options.cwd
        ? await listSessionDirectories(options.fs, sessionsRoot)
        : [path.join(sessionsRoot, encodeWorkspacePath(options.cwd))];
    const references: TraceReference[] = [];

    for (const directory of directories) {
      for (const filePath of await listJsonlFiles(options.fs, directory)) {
        const stat = await options.fs.stat(filePath);
        const updatedAt = stat.mtime;
        if (options.since && updatedAt && updatedAt < options.since) {
          continue;
        }
        const trace = readTraceContents(filePath, await options.fs.readFile(filePath, "utf8"));
        references.push({
          source: "pi",
          id: trace.id,
          path: filePath,
          ...(trace.cwd ? { cwd: trace.cwd } : {}),
          ...(updatedAt ? { updatedAt } : {}),
          ...(trace.title ? { title: trace.title } : {}),
          ...(trace.model ? { metadata: { model: trace.model } } : {})
        });
      }
    }
    return references;
  },
  async read(reference, options): Promise<NormalizedTrace> {
    if (!reference.path) {
      throw new Error(`Pi trace ${reference.id} has no path.`);
    }
    return readTraceContents(reference.path, await options.fs.readFile(reference.path, "utf8"));
  }
};
