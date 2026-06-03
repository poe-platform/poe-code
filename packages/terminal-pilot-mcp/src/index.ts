import { defineCommand, defineGroup, type Command } from "toolcraft";
import { runMCP } from "toolcraft/mcp";
import { createTerminalPilotGroup, type TerminalPilotCommandServices } from "terminal-pilot/commands";

type TerminalPilotMCPCommand = Command<TerminalPilotCommandServices, any, any, any>;

export function createTerminalPilotMCPGroup() {
  const group = createTerminalPilotGroup();
  const legacyCommands = group.children
    .filter(
      (child): child is TerminalPilotMCPCommand =>
        child.kind === "command" && child.scope.includes("mcp")
    )
    .map((command) =>
      defineCommand({
        name: `terminal-${command.name}`,
        description: command.description,
        params: command.params,
        secrets: command.secrets,
        scope: ["mcp"],
        confirm: command.confirm,
        humanInLoop: command.humanInLoop,
        requires: command.requires,
        handler: command.handler,
        render: command.render
      })
    );

  return defineGroup({
    name: "",
    scope: ["mcp"] as const,
    children: [...group.children, ...legacyCommands]
  });
}

export async function main(): Promise<void> {
  await runMCP(createTerminalPilotMCPGroup(), {
    name: "terminal-pilot",
    version: "0.0.1",
    omitRootToolNamePrefix: true
  });
}
