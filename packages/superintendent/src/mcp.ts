#!/usr/bin/env node
import * as fsPromises from "node:fs/promises";
import { createMCPServer } from "toolcraft/mcp";
import { createServer, type Server } from "tiny-stdio-mcp-server";
import { isDirectExecution } from "./direct-execution.js";
import { superintendentMcpGroup } from "./commands/index.js";
import {
  resolveSuperintendentDoc,
  type StatusBlock,
  type SuperintendentDoc
} from "./document/parse.js";
import { runBuilder } from "./runtime/run-builder.js";
import { runInspector } from "./runtime/run-inspector.js";
import {
  createWorkflowTool,
  parseWorkflowCall,
  type McpToolDefinition as WorkflowToolDefinition,
  type WorkflowTransition
} from "./runtime/workflow-tool.js";
import {
  createBuilderTool,
  createInspectorTool,
  parseBuilderRunInput,
  parseInspectorRunInput
} from "./runtime/agentic-tools.js";

const MCP_NAME = "superintendent";
const MCP_VERSION = "0.0.1";
const SUPERINTENDENT_TOOLS_SUBCOMMAND = "superintendent-tools";
const SUPERINTENDENT_TOOLS_SERVER_NAME = "superintendent-agentic-tools";
const WORKFLOW_TRANSITION_SUBCOMMAND = "workflow-transition";
const WORKFLOW_TRANSITION_SERVER_NAME = "superintendent-workflow-transition";

export type SuperintendentToolsPayload = {
  docPath: string;
  state: StatusBlock["state"];
  inspectorNames: string[];
};

export type McpRunners = {
  superintendentMcpGroup?: typeof superintendentMcpGroup;
  runBuilder?: typeof runBuilder;
  runInspector?: typeof runInspector;
  parseSuperintendentDoc?: (
    docPath: string,
    content: string
  ) => SuperintendentDoc | Promise<SuperintendentDoc>;
};

type ResolvedMcpRunners = {
  superintendentMcpGroup: typeof superintendentMcpGroup;
  runBuilder: typeof runBuilder;
  runInspector: typeof runInspector;
  parseSuperintendentDoc: (
    docPath: string,
    content: string
  ) => SuperintendentDoc | Promise<SuperintendentDoc>;
};

export type MainOptions = {
  runners?: McpRunners;
};

function resolveMcpRunners(overrides?: McpRunners): ResolvedMcpRunners {
  return {
    superintendentMcpGroup: overrides?.superintendentMcpGroup ?? superintendentMcpGroup,
    runBuilder: overrides?.runBuilder ?? runBuilder,
    runInspector: overrides?.runInspector ?? runInspector,
    parseSuperintendentDoc:
      overrides?.parseSuperintendentDoc ??
      (async (docPath, content) =>
        (await resolveSuperintendentDoc(docPath, content, fsPromises)).document)
  };
}

export function createSuperintendentMcpServer(runners?: McpRunners) {
  const resolved = resolveMcpRunners(runners);
  return createMCPServer([resolved.superintendentMcpGroup], {
    name: MCP_NAME,
    version: MCP_VERSION
  });
}

export async function main(
  argv: string[] = process.argv,
  options: MainOptions = {}
): Promise<void> {
  const runners = resolveMcpRunners(options.runners);
  const originalArgv = process.argv;
  process.argv = argv;

  try {
    if (argv[2] === SUPERINTENDENT_TOOLS_SUBCOMMAND) {
      await runSuperintendentToolsServer(argv[3], runners);
      return;
    }

    if (argv[2] === WORKFLOW_TRANSITION_SUBCOMMAND) {
      await runWorkflowTransitionServer(argv[3]);
      return;
    }

    await createSuperintendentMcpServer(options.runners).listen();
  } finally {
    process.argv = originalArgv;
  }
}

async function runSuperintendentToolsServer(
  encodedPayload: string | undefined,
  runners: ResolvedMcpRunners
): Promise<void> {
  const payload = decodeSuperintendentToolsPayload(encodedPayload);

  const server = createServer({
    name: SUPERINTENDENT_TOOLS_SERVER_NAME,
    version: MCP_VERSION
  });

  registerWorkflowTool(server, payload.state);
  registerBuilderTool(server, payload.docPath, runners);
  registerInspectorTool(server, payload.docPath, payload.inspectorNames, runners);

  await server.listen();
}

function registerWorkflowTool(server: Server, state: StatusBlock["state"]): void {
  const tool = createWorkflowTool("superintendent", state);

  registerWorkflowToolDefinition(server, tool);
}

async function runWorkflowTransitionServer(encodedTool: string | undefined): Promise<void> {
  const tool = decodeWorkflowTool(encodedTool);

  const server = createServer({
    name: WORKFLOW_TRANSITION_SERVER_NAME,
    version: MCP_VERSION
  });

  registerWorkflowToolDefinition(server, tool);

  await server.listen();
}

function registerWorkflowToolDefinition(server: Server, tool: WorkflowToolDefinition): void {
  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const transition = parseWorkflowCall(input);
    assertAllowedAction(tool, transition.action);
    return { recorded: { action: transition.action } };
  }, tool.outputSchema);
}

function registerBuilderTool(
  server: Server,
  docPath: string,
  runners: ResolvedMcpRunners
): void {
  const tool = createBuilderTool();

  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const { prompt } = parseBuilderRunInput(input);
    const freshDoc = await readSuperintendentDoc(docPath, runners);
    const result = await runners.runBuilder(freshDoc, {}, {
      promptOverride: prompt,
      defaultCwd: process.cwd()
    });
    return result;
  }, tool.outputSchema);
}

function registerInspectorTool(
  server: Server,
  docPath: string,
  inspectorNames: string[],
  runners: ResolvedMcpRunners
): void {
  const tool = createInspectorTool(inspectorNames);

  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const parsed = parseInspectorRunInput(input, inspectorNames);
    const freshDoc = await readSuperintendentDoc(docPath, runners);
    const config = freshDoc.frontmatter.inspectors?.[parsed.name];

    if (!config) {
      throw new Error(`Inspector "${parsed.name}" is not configured in ${docPath}`);
    }

    const result = await runners.runInspector(
      parsed.name,
      config,
      freshDoc,
      {},
      {
        defaultCwd: process.cwd(),
        ...(parsed.prompt ? { promptOverride: parsed.prompt } : {})
      }
    );
    return result;
  }, tool.outputSchema);
}

async function readSuperintendentDoc(
  docPath: string,
  runners: ResolvedMcpRunners
): Promise<SuperintendentDoc> {
  const content = await fsPromises.readFile(docPath, "utf8");
  return runners.parseSuperintendentDoc(docPath, content);
}

function decodeSuperintendentToolsPayload(
  encodedPayload: string | undefined
): SuperintendentToolsPayload {
  if (typeof encodedPayload !== "string" || encodedPayload.trim().length === 0) {
    throw invalidSuperintendentToolsPayloadError();
  }

  try {
    const decoded = Buffer.from(encodedPayload, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;

    if (!isSuperintendentToolsPayload(parsed)) {
      throw invalidSuperintendentToolsPayloadError();
    }

    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === invalidSuperintendentToolsPayloadError().message
    ) {
      throw error;
    }

    throw invalidSuperintendentToolsPayloadError();
  }
}

function assertAllowedAction(
  tool: WorkflowToolDefinition,
  action: WorkflowTransition["action"]
): void {
  const allowedActions = tool.inputSchema.properties.action.enum ?? [];

  if (!allowedActions.includes(action)) {
    throw new Error(`workflow_transition action "${action}" is not allowed for this role/state`);
  }
}

function invalidSuperintendentToolsPayloadError(): Error {
  return new Error("Invalid superintendent-tools payload");
}

function decodeWorkflowTool(encodedTool: string | undefined): WorkflowToolDefinition {
  if (typeof encodedTool !== "string" || encodedTool.trim().length === 0) {
    throw invalidWorkflowTransitionPayloadError();
  }

  try {
    const decoded = Buffer.from(encodedTool, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;

    if (!isWorkflowToolDefinition(parsed)) {
      throw invalidWorkflowTransitionPayloadError();
    }

    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === invalidWorkflowTransitionPayloadError().message
    ) {
      throw error;
    }

    throw invalidWorkflowTransitionPayloadError();
  }
}

function invalidWorkflowTransitionPayloadError(): Error {
  return new Error("Invalid workflow-transition payload");
}

function isWorkflowToolDefinition(value: unknown): value is WorkflowToolDefinition {
  if (!isRecord(value)) {
    return false;
  }

  if (value.name !== "workflow_transition" || typeof value.description !== "string") {
    return false;
  }

  const inputSchema = value.inputSchema;

  if (!isRecord(inputSchema) || inputSchema.type !== "object") {
    return false;
  }

  const properties = inputSchema.properties;

  if (!isRecord(properties) || !isRecord(properties.action)) {
    return false;
  }

  return properties.action.type === "string";
}

function isSuperintendentToolsPayload(value: unknown): value is SuperintendentToolsPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.docPath === "string" &&
    value.docPath.length > 0 &&
    isStatusState(value.state) &&
    Array.isArray(value.inspectorNames) &&
    value.inspectorNames.every((name) => typeof name === "string")
  );
}

function isStatusState(value: unknown): value is StatusBlock["state"] {
  return value === "in_progress" || value === "review" || value === "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (await isDirectExecution(import.meta.url, process.argv)) {
  await main();
}
