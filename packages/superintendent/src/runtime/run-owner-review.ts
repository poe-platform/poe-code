import "@poe-code/agent-spawn/register-factories";
import type { McpConfig, SuperintendentDoc } from "../document/parse.js";
import {
  runAutonomousAgent,
  type AutonomousOutput,
  type McpSpawnConfig
} from "./agent-runner.js";
import { resolveRoleCwd } from "./resolve-cwd.js";
import { buildOwnerSystemPrompt, prependSystemPrompt } from "./system-prompt.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";
import {
  createWorkflowTool,
  parseWorkflowCall,
  type WorkflowTransition
} from "./workflow-tool.js";

type OwnerTransition = Extract<
  WorkflowTransition,
  { action: "approve_completion" } | { action: "request_changes" }
>;

export type OwnerResult = {
  transition: OwnerTransition;
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

const WORKFLOW_SERVER_NAME = "owner-workflow";
const WORKFLOW_SERVER_COMMAND = "poe-superintendent-mcp";
const WORKFLOW_SERVER_SUBCOMMAND = "workflow-transition";
const WORKFLOW_SERVER_TIMEOUT_SECONDS = 7200;

export type RunOwnerReviewOptions = {
  defaultCwd: string;
  logPath?: string;
  signal?: AbortSignal;
};

export async function runOwnerReview(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: RunOwnerReviewOptions
): Promise<OwnerResult> {
  const userPrompt = resolveTemplate(
    doc.frontmatter.owner.prompt,
    buildTemplateContext(doc, context)
  );
  const prompt = prependSystemPrompt(buildOwnerSystemPrompt(), userPrompt);
  const result = await runAutonomousAgent({
    agent: doc.frontmatter.owner.agent,
    mode: doc.frontmatter.owner.mode,
    prompt,
    cwd: resolveRoleCwd(doc.frontmatter.owner, doc.filePath, options.defaultCwd),
    mcpServers: buildMcpServers(doc),
    ...(options.logPath ? { logPath: options.logPath } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  });

  const logPath = extractLogPath(result);
  return {
    transition: extractOwnerTransition(result),
    ...(logPath ? { log_path: logPath } : {})
  };
}

function buildTemplateContext(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Partial<TemplateContext> {
  return { ...context, plan: { path: doc.filePath } };
}

function buildMcpServers(doc: SuperintendentDoc): McpSpawnConfig {
  const servers = Object.create(null) as McpSpawnConfig;
  servers[WORKFLOW_SERVER_NAME] = createWorkflowServer();

  const merged = Object.assign(
    Object.create(null) as NonNullable<SuperintendentDoc["frontmatter"]["mcp"]>,
    doc.frontmatter.mcp,
    doc.frontmatter.owner.mcp
  );

  for (const [name, config] of Object.entries(merged)) {
    servers[name] = toSpawnMcpServer(config);
  }

  return servers;
}

function createWorkflowServer(): McpSpawnConfig[string] {
  const workflowTool = createWorkflowTool("owner", "review");

  return {
    command: WORKFLOW_SERVER_COMMAND,
    args: [WORKFLOW_SERVER_SUBCOMMAND, encodeJson(workflowTool)],
    timeout: WORKFLOW_SERVER_TIMEOUT_SECONDS
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

function extractOwnerTransition(result: AutonomousOutput): OwnerTransition {
  const transition = extractTransition(result);

  if (transition === undefined) {
    throw new Error(`Owner review must end with workflow_transition.${describeMissingTransition(result)}`);
  }

  if (transition.action !== "approve_completion" && transition.action !== "request_changes") {
    throw new Error(`Owner review returned invalid transition: ${transition.action}`);
  }

  return transition;
}

function describeMissingTransition(result: AutonomousOutput): string {
  const parts: string[] = [];
  const names = collectToolNames(result);
  parts.push(names.length === 0 ? " No tool calls were captured." : ` Observed tool calls: ${names.join(", ")}.`);

  const logPath = extractLogPath(result);
  if (logPath) {
    parts.push(` See spawn log: ${logPath}`);
  }

  return parts.join("");
}

function collectToolNames(result: AutonomousOutput): string[] {
  if (typeof result === "string") {
    return [];
  }

  const names: string[] = [];
  collectToolNamesFrom(result.toolCalls, names);

  if (isRecord(result.sessionResult)) {
    collectToolNamesFrom(result.sessionResult.toolCalls, names);
  }

  return names;
}

function collectToolNamesFrom(value: unknown, out: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    const toolCall = readToolCall(entry);
    const name = toolCall ? readToolCallName(toolCall) : undefined;
    if (name) {
      out.push(name);
    }
  }
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
