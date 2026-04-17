import { describe, expect, it, vi } from "vitest";
import mcpPlugin from "./poe-agent-plugin-mcp.js";

describe("poe-agent-plugin-mcp", () => {
  it("wraps one MCP server as a standard plugin", () => {
    const addMcp = vi.fn();
    const plugin = mcpPlugin({
      name: "repo",
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
      visibility: "skill",
    });

    plugin.setup?.({
      addMcp,
      addTool: vi.fn(),
      getTool: vi.fn(),
    });

    expect(plugin.name).toBe("mcp:repo");
    expect(addMcp).toHaveBeenCalledWith({
      name: "repo",
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
      visibility: "skill",
    });
  });
});
