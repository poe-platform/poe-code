import "@poe-code/agent-spawn/register-factories";
import type { McpConfig, SuperintendentDoc } from "../document/parse.js";
import {
  runAutonomousAgent,
  type AutonomousOutput,
  type McpSpawnConfig
} from "./agent-runner.js";
import { resolveRoleCwd } from "./resolve-cwd.js";
import {
  buildSuperintendentSystemPrompt,
  prependSystemPrompt
} from "./system-prompt.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";
import { parseWorkflowCall, type WorkflowTransition } from "./workflow-tool.js";

export type SuperintendentResult = {
  summary: string;
  transition?: WorkflowTransition;
  log_path?: string;
};

type ToolCallLike = {
  name?: unknown;
  tool?: unknown;
  title?: unknown;
  path?: unknown;
  arguments?: unknown;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
};

const SUPERINTENDENT_TOOLS_SERVER_NAME = "superintendent-tools";
const SUPERINTENDENT_TOOLS_SERVER_COMMAND = "poe-superintendent-mcp";
const SUPERINTENDENT_TOOLS_SERVER_SUBCOMMAND = "superintendent-tools";
const SUPERINTENDENT_TOOLS_TIMEOUT_SECONDS = 7200;

export type RunSuperintendentOptions = {
  defaultCwd: string;
  logPath?: string;
  signal?: AbortSignal;
};

export async function runSuperintendent(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: RunSuperintendentOptions
): Promise<SuperintendentResult> {
  const userPrompt = resolveTemplate(
    doc.frontmatter.superintendent.prompt,
    buildTemplateContext(doc, context)
  );
  const systemPrompt = buildSuperintendentSystemPrompt({
    state: doc.frontmatter.status.state,
    inspectorNames: Object.keys(doc.frontmatter.inspectors ?? {})
  });
  const prompt = prependSystemPrompt(systemPrompt, userPrompt);
  const result = await runAutonomousAgent({
    agent: doc.frontmatter.superintendent.agent,
    mode: doc.frontmatter.superintendent.mode,
    prompt,
    cwd: resolveRoleCwd(doc.frontmatter.superintendent, doc.filePath, options.defaultCwd),
    mcpServers: buildMcpServers(doc),
    ...(options.logPath ? { logPath: options.logPath } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  });
  const transition = extractTransition(result);
  const logPath = extractLogPath(result);

  return {
    summary: extractSummary(result, transition),
    ...(transition ? { transition } : {}),
    ...(logPath ? { log_path: logPath } : {})
  };
}

function buildTemplateContext(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Partial<TemplateContext> {
  return {
    ...context,
    plan: {
      ...(context.plan ?? { path: doc.filePath }),
      path: doc.filePath
    }
  };
}

function buildMcpServers(doc: SuperintendentDoc): McpSpawnConfig {
  const servers = Object.create(null) as McpSpawnConfig;
  servers[SUPERINTENDENT_TOOLS_SERVER_NAME] = createSuperintendentToolsServer(doc);

  const merged = Object.assign(
    Object.create(null) as NonNullable<SuperintendentDoc["frontmatter"]["mcp"]>,
    doc.frontmatter.mcp,
    doc.frontmatter.superintendent.mcp
  );

  for (const [name, config] of Object.entries(merged)) {
    servers[name] = toSpawnMcpServer(config);
  }

  return servers;
}

function createSuperintendentToolsServer(doc: SuperintendentDoc): McpSpawnConfig[string] {
  const payload = {
    docPath: doc.filePath,
    state: doc.frontmatter.status.state,
    inspectorNames: Object.keys(doc.frontmatter.inspectors ?? {})
  };

  return {
    command: SUPERINTENDENT_TOOLS_SERVER_COMMAND,
    args: [SUPERINTENDENT_TOOLS_SERVER_SUBCOMMAND, encodeJson(payload)],
    timeout: SUPERINTENDENT_TOOLS_TIMEOUT_SECONDS
  };
}

function toSpawnMcpServer(config: McpConfig): McpSpawnConfig[string] {
  return {
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {})
  };
}

function extractLogPath(result: AutonomousOutput): string | undefined {
  if (typeof result === "string") return undefined;
  return typeof result.logFile === "string" ? result.logFile : undefined;
}

function extractTransition(result: AutonomousOutput): WorkflowTransition | undefined {
  if (typeof result === "string") {
    return undefined;
  }

  const toolCallTransition = readTransitionFromToolCalls(result.toolCalls);

  if (toolCallTransition) {
    return toolCallTransition;
  }

  return readTransitionFromSessionResult(result.sessionResult);
}

function readTransitionFromToolCalls(value: unknown): WorkflowTransition | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const entry of value) {
    const toolCall = readToolCall(entry);

    if (!toolCall || !isWorkflowToolName(readToolCallName(toolCall))) {
      continue;
    }

    const transitionValue = readToolCallResult(toolCall) ?? readToolCallArguments(toolCall);

    if (transitionValue !== undefined) {
      return parseWorkflowCall(parseJsonValue(transitionValue));
    }
  }

  return undefined;
}

function readTransitionFromSessionResult(value: unknown): WorkflowTransition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return readTransitionFromToolCalls(value.toolCalls);
}

function extractSummary(
  result: AutonomousOutput,
  transition: WorkflowTransition | undefined
): string {
  if (typeof result !== "string") {
    const explicitSummary = readString(result.summary)?.trim();

    if (explicitSummary) {
      return explicitSummary;
    }
  }

  if (transition?.action === "request_review") {
    return transition.summary;
  }

  const firstNonEmptyLine = splitLines(extractOutputText(result))
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstNonEmptyLine ?? "Superintendent completed without output.";
}

function extractOutputText(result: AutonomousOutput): string {
  if (typeof result === "string") {
    return result;
  }

  return (
    readString(result.output) ??
    readString(result.stdout) ??
    readString(result.text) ??
    ""
  );
}

function readToolCall(value: unknown): ToolCallLike | undefined {
  return isRecord(value) ? value : undefined;
}

function readToolCallName(toolCall: ToolCallLike): string | undefined {
  return (
    readString(toolCall.name) ??
    readString(toolCall.tool) ??
    readString(toolCall.title) ??
    readString(toolCall.path)
  );
}

function readToolCallArguments(toolCall: ToolCallLike): unknown {
  return toolCall.arguments ?? toolCall.args ?? toolCall.input;
}

function readToolCallResult(toolCall: ToolCallLike): unknown {
  const candidate = readStructuredToolResult(toolCall.result) ?? readStructuredToolResult(toolCall.output);

  if (isRecord(candidate) && isRecord(candidate.recorded)) {
    return candidate.recorded;
  }

  return candidate;
}

function readStructuredToolResult(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.structuredContent !== undefined) {
    return value.structuredContent;
  }

  const content = value.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((item) => isRecord(item) && typeof item.text === "string" ? item.text : undefined)
    .find((item): item is string => item !== undefined);

  return text === undefined ? undefined : parseJsonValue(text);
}

function isWorkflowToolName(name: string | undefined): boolean {
  if (!name) return false;
  if (name === "workflow_transition") return true;
  return name.startsWith("mcp__") && name.endsWith("__workflow_transition");
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return value;
  }

  const parsed = tryParseJson(trimmed);

  return parsed === undefined ? value : parsed;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
