import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  agent,
  openaiResponsesPlugin,
  systemPromptPlugin,
  type AgentBuilder,
  type AgentPlugin,
  type McpServerConfig,
  type ProviderStreamEvent
} from "./agent.js";

describe("public composable agent API", () => {
  it("exposes the constrained runtime building blocks", () => {
    expect(agent).toEqual(expect.any(Function));
    expect(openaiResponsesPlugin).toEqual(expect.any(Function));
    expect(systemPromptPlugin).toEqual(expect.any(Function));
  });

  it("allows application-owned plugins and selected MCP tools", () => {
    const plugin: AgentPlugin = { name: "application-tools" };
    const server: McpServerConfig = {
      name: "mention_bot_tools",
      command: "bun",
      args: ["packages/team-bot-tools/src/mcp.ts"]
    };

    const built = agent()
      .model("gpt-5.5")
      .use(openaiResponsesPlugin())
      .use(systemPromptPlugin())
      .use(plugin)
      .mcp(server);

    expectTypeOf(built).toEqualTypeOf<AgentBuilder>();
  });

  it("runs with only a consumer-owned provider plugin", async () => {
    const events: ProviderStreamEvent[] = [
      { type: "text", text: "ready" },
      { type: "stop", reason: "end_turn" }
    ];
    const plugin: AgentPlugin = {
      name: "application-model",
      providers: [
        {
          name: "application-provider",
          supports: (modelId) => modelId === "application/model",
          createModel: () => ({
            complete: async () => ({
              events: (async function* () {
                yield* events;
              })()
            })
          })
        }
      ]
    };

    const result = await agent().model("application/model").use(plugin).run("Respond");

    expect(result.output).toBe("ready");
  });

  it("publishes a focused agent subpath", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports["./agent"]).toEqual({
      types: "./dist/agent.d.ts",
      import: "./dist/agent.js"
    });
  });

  it("publishes a focused skills subpath", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports["./skills"]).toEqual({
      types: "./dist/skills.d.ts",
      import: "./dist/skills.js"
    });
  });
});
