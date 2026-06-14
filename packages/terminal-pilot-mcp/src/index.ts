import { defineCommand, defineGroup, S, type Command } from "toolcraft";
import { runMCP } from "toolcraft/mcp";
import type { ObjectSchema } from "toolcraft-schema";
import { createTerminalPilotGroup, type TerminalPilotCommandServices } from "terminal-pilot/commands";

type TerminalPilotMCPCommand = Command<TerminalPilotCommandServices, any, any, any>;

const emptyResult = S.Object({});
const sessionCreatedResult = S.Object({
  session: S.String(),
  pid: S.Number()
});
const exitCodeResult = S.Object({
  exitCode: S.Number({ nullable: true })
});
const sessionMetadataResult = S.Object({
  session: S.String(),
  pid: S.Number(),
  command: S.String(),
  exitCode: S.Number({ nullable: true })
});
const listSessionsResult = S.Object({
  sessions: S.Array(S.Object({
    session: S.String(),
    command: S.String(),
    pid: S.Number()
  }))
});
const waitForResult = S.Object({
  matched: S.Boolean(),
  line: S.String()
});
const readScreenResult = S.Object({
  lines: S.Array(S.String()),
  cursor: S.Object({
    row: S.Number(),
    col: S.Number()
  }),
  size: S.Object({
    rows: S.Number(),
    cols: S.Number()
  }),
  exitCode: S.Number({ nullable: true })
});
const readHistoryResult = S.Object({
  lines: S.Array(S.String()),
  exitCode: S.Number({ nullable: true })
});

function getResultSchema(commandName: string): ObjectSchema<any> {
  switch (commandName) {
    case "create-session":
      return sessionCreatedResult;
    case "close-session":
    case "wait-for-exit":
      return exitCodeResult;
    case "get-session":
      return sessionMetadataResult;
    case "list-sessions":
      return listSessionsResult;
    case "wait-for":
      return waitForResult;
    case "read-screen":
      return readScreenResult;
    case "read-history":
      return readHistoryResult;
    case "fill":
    case "type":
    case "press-key":
    case "send-signal":
    case "resize":
      return emptyResult;
    default:
      throw new Error(`Missing terminal-pilot MCP result schema for ${commandName}`);
  }
}

function createMcpCommand(command: TerminalPilotMCPCommand, name: string): TerminalPilotMCPCommand {
  return defineCommand({
    name,
    description: command.description,
    params: command.params,
    result: getResultSchema(command.name),
    secrets: command.secrets,
    scope: ["mcp"],
    confirm: command.confirm,
    humanInLoop: command.humanInLoop,
    requires: command.requires,
    handler: async (context) => {
      const result = await command.handler(context);
      return result === undefined ? {} : result;
    },
    render: command.render
  });
}

export function createTerminalPilotMCPGroup() {
  const group = createTerminalPilotGroup();
  const mcpCommands = group.children.filter(
      (child): child is TerminalPilotMCPCommand =>
        child.kind === "command" && child.scope.includes("mcp")
    );
  const typedCommands = mcpCommands.map((command) => createMcpCommand(command, command.name));
  const legacyCommands = mcpCommands.map((command) => createMcpCommand(command, `terminal-${command.name}`));

  return defineGroup({
    name: "",
    scope: ["mcp"] as const,
    children: [...typedCommands, ...legacyCommands]
  });
}

export async function main(): Promise<void> {
  await runMCP(createTerminalPilotMCPGroup(), {
    name: "terminal-pilot",
    version: "0.0.1",
    omitRootToolNamePrefix: true
  });
}
