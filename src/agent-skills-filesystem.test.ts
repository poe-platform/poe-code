import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { agent, skillsPlugin } from "./agent.js";
import { toAcpModelResponse } from "../packages/poe-agent/src/testing/model-response.js";

const connect = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {},
  McpClient: class {
    connect = connect;
    close = close;
    async listTools() { return { tools: [] }; }
  }
}));

it("exports a virtual skill catalog and accepts a grant for one trusted MCP server", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/skills/demo", { recursive: true });
  await fs.writeFile("/skills/demo/SKILL.md", new TextEncoder().encode("# Demo\nUse this virtual skill."));
  let system = "";
  await agent({ fs, cwd: "/" })
    .use(skillsPlugin({ directories: ["/skills"] }))
    .use({ name: "inspect", prompt(ctx) { system = ctx.system ?? ""; return ctx; } })
    .mcp({ name: "trusted", command: "synthetic", trustedHost: true })
    .run("hello", { acpModel: { complete: async () => toAcpModelResponse({ content: "done" }) } });
  expect(system).toContain("/skills/demo/SKILL.md");
  expect(system).toContain("demo");
  expect(connect).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  await expect(agent({ fs }).mcp({ name: "ungranted", command: "synthetic" }).acp("hello", {
    acpModel: { complete: async () => toAcpModelResponse({ content: "done" }) }
  })).rejects.toMatchObject({ cause: { message: expect.stringContaining("host capability") } });
  expect(connect).toHaveBeenCalledOnce();
});
