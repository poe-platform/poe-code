import { spawn, type McpSpawnConfig, type SpawnMode } from "@poe-code/agent-spawn";
import type { McpConfig, SuperintendentDoc } from "../document/parse.js";
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

type AutonomousInput = {
  agent: string;
  mode?: string;
  prompt: string;
  cwd?: string;
  mcpServers?: McpSpawnConfig;
  logDir?: string;
  logFileName?: string;
};

type ToolCallLike = {
  name?: unknown;
  tool?: unknown;
  title?: unknown;
  path?: unknown;
  arguments?: unknown;
  args?: unknown;
  input?: unknown;
};

type AutonomousOutput =
  | string
  | {
      toolCalls?: unknown;
      sessionResult?: unknown;
      stdout?: unknown;
      logFile?: unknown;
    };

type SpawnWithAutonomous = typeof spawn & {
  autonomous?: (
    agent: string,
    options: Omit<AutonomousInput, "agent">
  ) => Promise<AutonomousOutput>;
};

const WORKFLOW_SERVER_NAME = "owner-workflow";
const WORKFLOW_SERVER_COMMAND = "poe-superintendent-mcp";
const WORKFLOW_SERVER_SUBCOMMAND = "workflow-transition";
const WORKFLOW_SERVER_TIMEOUT_SECONDS = 7200;

export type RunOwnerReviewOptions = {
  defaultCwd: string;
  logDir?: string;
  logFileName?: string;
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
  const result = await runAutonomous({
    agent: doc.frontmatter.owner.agent,
    mode: doc.frontmatter.owner.mode,
    prompt,
    cwd: resolveRoleCwd(doc.frontmatter.owner, doc.filePath, options.defaultCwd),
    mcpServers: buildMcpServers(doc),
    ...(options.logDir ? { logDir: options.logDir } : {}),
    ...(options.logFileName ? { logFileName: options.logFileName } : {})
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
  const servers: McpSpawnConfig = {
    [WORKFLOW_SERVER_NAME]: createWorkflowServer()
  };

  const merged = {
    ...(doc.frontmatter.mcp ?? {}),
    ...(doc.frontmatter.owner.mcp ?? {})
  };

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

async function runAutonomous(input: AutonomousInput): Promise<AutonomousOutput> {
  const spawnApi = spawn as SpawnWithAutonomous;

  if (typeof spawnApi.autonomous === "function") {
    return spawnApi.autonomous(input.agent, {
      cwd: input.cwd,
      prompt: input.prompt,
      mode: input.mode,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.logDir ? { logDir: input.logDir } : {}),
      ...(input.logFileName ? { logFileName: input.logFileName } : {})
    });
  }

  const result = await spawn(input.agent, {
    cwd: input.cwd,
    prompt: input.prompt,
    mode: input.mode as SpawnMode | undefined,
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    ...(input.logDir ? { logDir: input.logDir } : {}),
    ...(input.logFileName ? { logFileName: input.logFileName } : {})
  });

  return {
    stdout: result.stdout,
    ...(result.logFile ? { logFile: result.logFile } : {})
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

    const argumentsValue = readToolCallArguments(toolCall);

    if (argumentsValue === undefined) {
      continue;
    }

    return parseWorkflowCall(parseJsonValue(argumentsValue));
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
