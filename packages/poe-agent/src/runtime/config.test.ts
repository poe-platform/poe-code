import { describe, expect, it } from "vitest";
import {
  createResolvedAgentConfig,
  resolvePluginSetupOrder,
  toRuntimePlugins,
  type ResolvedAgentConfig,
} from "./config.js";

describe("runtime/config", () => {
  it("creates frozen config snapshots with cloned arrays", () => {
    const input: ResolvedAgentConfig = {
      model: "gpt-5",
      plugins: [
        {
          name: "plugin-a",
          tools: [{ name: "tool.a", call: () => "ok" }],
        },
      ],
      mcpServers: [
        {
          name: "repo",
          command: "node",
          args: ["server.js"],
          env: { NODE_ENV: "test" },
        },
      ],
    };

    const resolved = createResolvedAgentConfig(input);

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.plugins)).toBe(true);
    expect(Object.isFrozen(resolved.mcpServers)).toBe(true);

    input.plugins.push({ name: "plugin-b" });
    input.mcpServers[0]?.args?.push("--watch");

    expect(resolved.plugins).toHaveLength(1);
    expect(resolved.mcpServers[0]?.args).toEqual(["server.js"]);
  });

  it("resolves dependencies in topological order", () => {
    const ordered = resolvePluginSetupOrder([
      {
        name: "beta",
        dependencies: ["alpha"],
      },
      {
        name: "alpha",
      },
      {
        name: "gamma",
        dependencies: ["beta"],
      },
    ]);

    expect(ordered.map(plugin => plugin.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("resolves dependencies even when plugin names contain extra whitespace", () => {
    const ordered = resolvePluginSetupOrder([
      {
        name: " beta ",
        dependencies: ["alpha"],
      },
      {
        name: " alpha ",
      },
    ]);

    expect(ordered.map(plugin => plugin.name)).toEqual([" alpha ", " beta "]);
  });

  it("throws for plugin dependency cycles", () => {
    expect(() =>
      resolvePluginSetupOrder([
        {
          name: "alpha",
          dependencies: ["beta"],
        },
        {
          name: "beta",
          dependencies: ["alpha"],
        },
      ]),
    ).toThrow('Circular plugin dependencies detected: "alpha" -> "beta" -> "alpha".');
  });

  it("creates synthetic MCP setup plugins", () => {
    const runtimePlugins = toRuntimePlugins(
      createResolvedAgentConfig({
        plugins: [{ name: "alpha" }],
        mcpServers: [
          {
            name: "repo",
            command: "node",
            args: ["server.js"],
          },
        ],
      }),
    );

    expect(runtimePlugins.map(plugin => plugin.name)).toEqual(["alpha", "mcp:repo"]);
  });
});
