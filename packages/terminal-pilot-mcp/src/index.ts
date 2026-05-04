import { runMCP } from "toolcraft/mcp";
import { terminalPilotGroup } from "terminal-pilot/commands";

export async function main(): Promise<void> {
  await runMCP(terminalPilotGroup, {
    name: "terminal-pilot",
    version: "0.0.1",
    omitRootToolNamePrefix: true
  });
}
