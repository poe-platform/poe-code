import { runMCP } from "@poe-code/cmdkit/mcp";
import { terminalPilotGroup } from "terminal-pilot/commands";

export async function main(): Promise<void> {
  await runMCP(terminalPilotGroup, {
    name: "terminal-pilot",
    version: "0.0.1"
  });
}
