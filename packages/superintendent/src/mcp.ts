#!/usr/bin/env node
import { createMCPServer } from "@poe-code/cmdkit/mcp";
import { createServer } from "tiny-stdio-mcp-server";
import { isDirectExecution } from "./direct-execution.js";
import { superintendentMcpGroup } from "./commands/index.js";
import {
  parseWorkflowCall,
  type McpToolDefinition,
  type WorkflowTransition
} from "./runtime/workflow-tool.js";

const MCP_NAME = "superintendent";
const MCP_VERSION = "0.0.1";
const WORKFLOW_TRANSITION_SUBCOMMAND = "workflow-transition";
const WORKFLOW_TRANSITION_SERVER_NAME = "superintendent-workflow-transition";

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
    if (argv[2] === WORKFLOW_TRANSITION_SUBCOMMAND) {
      await runWorkflowTransitionServer(argv[3]);
      return;
    }

    await createSuperintendentMcpServer().listen();
  } finally {
    process.argv = originalArgv;
  }
}

async function runWorkflowTransitionServer(encodedTool: string | undefined): Promise<void> {
  const tool = decodeWorkflowTransitionTool(encodedTool);
  const server = createServer({
    name: WORKFLOW_TRANSITION_SERVER_NAME,
    version: MCP_VERSION
  });

  server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
    const transition = parseWorkflowCall(input);
    assertAllowedAction(tool, transition.action);
    return `Recorded workflow transition: ${transition.action}`;
  });

  await server.listen();
}

function decodeWorkflowTransitionTool(encodedTool: string | undefined): McpToolDefinition {
  if (typeof encodedTool !== "string" || encodedTool.trim().length === 0) {
    throw invalidWorkflowTransitionToolDefinitionError();
  }

  try {
    const decoded = Buffer.from(encodedTool, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;

    if (!isWorkflowToolDefinition(parsed)) {
      throw invalidWorkflowTransitionToolDefinitionError();
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === invalidWorkflowTransitionToolDefinitionError().message) {
      throw error;
    }

    throw invalidWorkflowTransitionToolDefinitionError();
  }
}

function assertAllowedAction(
  tool: McpToolDefinition,
  action: WorkflowTransition["action"]
): void {
  const allowedActions = tool.inputSchema.properties.action.enum ?? [];

  if (!allowedActions.includes(action)) {
    throw new Error(`workflow.transition action "${action}" is not allowed for this role/state`);
  }
}

function invalidWorkflowTransitionToolDefinitionError(): Error {
  return new Error("Invalid workflow transition tool definition");
}

function isWorkflowToolDefinition(value: unknown): value is McpToolDefinition {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.name === "workflow.transition" &&
    typeof value.description === "string" &&
    isRecord(value.inputSchema) &&
    value.inputSchema.type === "object" &&
    Array.isArray(value.inputSchema.required) &&
    isRecord(value.inputSchema.properties) &&
    isRecord(value.inputSchema.properties.action) &&
    Array.isArray(value.inputSchema.properties.action.enum)
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (await isDirectExecution(import.meta.url, process.argv)) {
  await main();
}
