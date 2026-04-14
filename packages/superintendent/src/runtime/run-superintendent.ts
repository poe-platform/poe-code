import path from "node:path";
import { spawn, type McpSpawnConfig, type SpawnMode } from "@poe-code/agent-spawn";
import type { McpConfig, SuperintendentDoc } from "../document/parse.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";
import {
  createWorkflowTool,
  parseWorkflowCall,
  type WorkflowTransition
} from "./workflow-tool.js";

export type SuperintendentResult = {
  summary: string;
  transition?: WorkflowTransition;
};

type AutonomousInput = {
  agent: string;
  mode?: string;
  prompt: string;
  cwd?: string;
  mcpServers?: McpSpawnConfig;
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
      summary?: unknown;
      output?: unknown;
      stdout?: unknown;
      text?: unknown;
      transition?: unknown;
      toolCalls?: unknown;
      sessionResult?: unknown;
    };

type SpawnWithAutonomous = typeof spawn & {
  autonomous?: (
    agent: string,
    options: Omit<AutonomousInput, "agent">
  ) => Promise<AutonomousOutput>;
};

const WORKFLOW_SERVER_NAME = "__superintendent_workflow_transition__";
const WORKFLOW_SERVER_COMMAND = "poe-superintendent-mcp";
const WORKFLOW_SERVER_SUBCOMMAND = "workflow-transition";

export async function runSuperintendent(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Promise<SuperintendentResult> {
  const prompt = resolveTemplate(
    doc.frontmatter.superintendent.prompt,
    buildTemplateContext(doc, context)
  );
  const result = await runAutonomous({
    agent: doc.frontmatter.superintendent.agent,
    mode: doc.frontmatter.superintendent.mode,
    prompt,
    cwd: path.dirname(doc.filePath),
    mcpServers: buildMcpServers(doc)
  });
  const transition = extractTransition(result);

  return {
    summary: extractSummary(result, transition),
    ...(transition ? { transition } : {})
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
  const servers: McpSpawnConfig = {
    [WORKFLOW_SERVER_NAME]: createWorkflowServer(doc)
  };

  for (const name of doc.frontmatter.superintendent.tools?.mcp ?? []) {
    servers[name] = toSpawnMcpServer(name, doc.frontmatter.mcp);
  }

  return servers;
}

function createWorkflowServer(doc: SuperintendentDoc): McpSpawnConfig[string] {
  const workflowTool = createWorkflowTool("superintendent", doc.frontmatter.status.state);

  return {
    command: WORKFLOW_SERVER_COMMAND,
    args: [WORKFLOW_SERVER_SUBCOMMAND, encodeJson(workflowTool)]
  };
}

function toSpawnMcpServer(name: string, mcpConfig: Record<string, McpConfig> | undefined): McpSpawnConfig[string] {
  const config = mcpConfig?.[name];

  if (config === undefined) {
    throw new Error(`Unknown MCP tool \`${name}\` referenced by superintendent.tools.mcp`);
  }

  return {
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {})
  };
}

async function runAutonomous(input: AutonomousInput): Promise<AutonomousOutput> {
  const spawnApi = spawn as SpawnWithAutonomous;

  if (typeof spawnApi.autonomous === "function") {
    return spawnApi.autonomous(input.agent, {
      cwd: input.cwd,
      prompt: input.prompt,
      mode: input.mode,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {})
    });
  }

  const result = await spawn(input.agent, {
    cwd: input.cwd,
    prompt: input.prompt,
    mode: input.mode as SpawnMode | undefined,
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {})
  });

  return {
    stdout: result.stdout
  };
}

function extractTransition(result: AutonomousOutput): WorkflowTransition | undefined {
  if (typeof result !== "string") {
    const directTransition = readTransition(result.transition);

    if (directTransition) {
      return directTransition;
    }

    const toolCallTransition = readTransitionFromToolCalls(result.toolCalls);

    if (toolCallTransition) {
      return toolCallTransition;
    }

    const sessionTransition = readTransitionFromSessionResult(result.sessionResult);

    if (sessionTransition) {
      return sessionTransition;
    }
  }

  return readTransitionFromText(extractOutputText(result));
}

function readTransition(value: unknown): WorkflowTransition | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseWorkflowCall(parseJsonValue(value));
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

function readTransitionFromText(text: string): WorkflowTransition | undefined {
  for (const line of splitLines(text)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith("workflow.transition(") && trimmed.endsWith(")")) {
      const payload = trimmed.slice("workflow.transition(".length, -1).trim();
      return parseWorkflowCall(parseJsonValue(payload));
    }

    if (!trimmed.startsWith("{")) {
      continue;
    }

    const parsed = tryParseJson(trimmed);

    if (!isRecord(parsed)) {
      continue;
    }

    if (parsed.transition !== undefined) {
      return parseWorkflowCall(parseJsonValue(parsed.transition));
    }

    if (parsed.action !== undefined) {
      return parseWorkflowCall(parsed);
    }
  }

  return undefined;
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

function isWorkflowToolName(name: string | undefined): boolean {
  return (
    name === "workflow.transition" ||
    name === `${WORKFLOW_SERVER_NAME}.workflow.transition`
  );
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
