import { describe, expect, it } from "vitest";
import { createTerminalPngMcpServer } from "./index.js";

describe("terminal-png MCP server", () => {
  it("advertises padding as a non-negative integer", async () => {
    const server = createTerminalPngMcpServer();
    await server.handleMessage("initialize", {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test", version: "1.0.0" }
    });

    const list = await server.handleMessage("tools/list");
    const tools = (list.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    const renderTool = tools.find((tool) => tool.name === "render_terminal_png");

    expect(renderTool?.inputSchema).toMatchObject({
      properties: {
        padding: {
          type: "integer",
          minimum: 0
        }
      }
    });
  });
});
