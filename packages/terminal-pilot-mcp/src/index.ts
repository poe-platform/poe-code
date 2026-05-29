import { runMCP } from "toolcraft/mcp";
import { createTerminalPilotGroup } from "terminal-pilot/commands";

export async function main(): Promise<void> {
  await runMCP(createTerminalPilotGroup(), {
    name: "terminal-pilot",
    version: "0.0.1",
    omitRootToolNamePrefix: true
  });
}
