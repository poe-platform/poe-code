#!/usr/bin/env node
import * as fsPromises from "node:fs/promises";
import { createMCPServer } from "@poe-code/cmdkit/mcp";
import { createServer, type Server } from "tiny-stdio-mcp-server";
import { isDirectExecution } from "./direct-execution.js";
import { superintendentMcpGroup } from "./commands/index.js";
import { parseSuperintendentDoc, type StatusBlock, type SuperintendentDoc } from "./document/parse.js";
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

export type SuperintendentToolsPayload = {
  docPath: string;
  state: StatusBlock["state"];
  inspectorNames: string[];
};

export function createSuperintendentMcpServer() {
  return createMCPServer([superintendentMcpGroup], {
    name: MCP_NAME,
    version: MCP_VERSION
  });
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const originalArgv = process.argv;
  process.argv = argv;

  try {
    if (argv[2] === SUPERINTENDENT_TOOLS_SUBCOMMAND) {
      await runSuperintendentToolsServer(argv[3]);
      return;
    }

    await createSuperintendentMcpServer().listen();
  } finally {
    process.argv = originalArgv;
  }
}

async function runSuperintendentToolsServer(encodedPayload: string | undefined): Promise<void> {
  const payload = decodeSuperintendentToolsPayload(encodedPayload);

  const server = createServer({
    name: SUPERINTENDENT_TOOLS_SERVER_NAME,
    version: MCP_VERSION
  });

  registerWorkflowTool(server, payload.state);
  registerBuilderTool(server, payload.docPath);
  registerInspectorTool(server, payload.docPath, payload.inspectorNames);

  await server.listen();
}

function registerWorkflowTool(server: Server, state: StatusBlock["state"]): void {
  const tool = createWorkflowTool("superintendent", state);

  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const transition = parseWorkflowCall(input);
    assertAllowedAction(tool, transition.action);
    return `Recorded workflow transition: ${transition.action}`;
  });
}

function registerBuilderTool(server: Server, docPath: string): void {
  const tool = createBuilderTool();

  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const { prompt } = parseBuilderRunInput(input);
    const freshDoc = await readSuperintendentDoc(docPath);
    const result = await runBuilder(freshDoc, {}, { promptOverride: prompt });
    return JSON.stringify(result);
  });
}

function registerInspectorTool(
  server: Server,
  docPath: string,
  inspectorNames: string[]
): void {
  const tool = createInspectorTool(inspectorNames);

  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const parsed = parseInspectorRunInput(input, inspectorNames);
    const freshDoc = await readSuperintendentDoc(docPath);
    const config = freshDoc.frontmatter.inspectors?.[parsed.name];

    if (!config) {
      throw new Error(`Inspector "${parsed.name}" is not configured in ${docPath}`);
    }

    const result = await runInspector(
      parsed.name,
      config,
      freshDoc,
      {},
      parsed.prompt ? { promptOverride: parsed.prompt } : {}
    );
    return JSON.stringify(result);
  });
}

async function readSuperintendentDoc(docPath: string): Promise<SuperintendentDoc> {
  const content = await fsPromises.readFile(docPath, "utf8");
  return parseSuperintendentDoc(docPath, content);
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
    throw new Error(`workflow.transition action "${action}" is not allowed for this role/state`);
  }
}

function invalidSuperintendentToolsPayloadError(): Error {
  return new Error("Invalid superintendent-tools payload");
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
