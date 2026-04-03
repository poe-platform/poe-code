import packageJson from "../package.json" with { type: "json" };
import { createServer, type Server } from "tiny-stdio-mcp-server";
import { terminalPilotMcpTools } from "./mcp-tools.js";
import { TerminalPilot } from "terminal-pilot";

type RuntimeProcess = Pick<typeof process, "on" | "off">;

export function createTerminalPilotMcpServer(agent: TerminalPilot): Server {
  const server = createServer({
    name: "terminal-pilot",
    version: packageJson.version
  });

  for (const tool of terminalPilotMcpTools(agent)) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.handler);
  }

  return server;
}

export async function main({
  launchAgent = TerminalPilot.launch,
  createMcpServer = createTerminalPilotMcpServer,
  runtimeProcess = process
}: {
  launchAgent?: typeof TerminalPilot.launch;
  createMcpServer?: (agent: TerminalPilot) => Server;
  runtimeProcess?: RuntimeProcess;
} = {}): Promise<void> {
  const agent = await launchAgent();
  let closed = false;

  const closeAgent = async (): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    await agent.close();
  };

  const handleExit = (): void => {
    void closeAgent();
  };

  runtimeProcess.on("exit", handleExit);

  try {
    await createMcpServer(agent).listen();
  } finally {
    runtimeProcess.off("exit", handleExit);
    await closeAgent();
  }
}
