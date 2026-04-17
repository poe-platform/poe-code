import { describe, expect, it } from "vitest";
import { resolvePluginsFromConfig } from "./resolve-plugins.js";

describe("resolvePluginsFromConfig", () => {
  it("returns plugins in config order", () => {
    const plugins = resolvePluginsFromConfig([
      { name: "system-prompt" },
      { name: "web" },
      { name: "shell", options: { cwd: "/workspace/project" } },
    ]);

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      "poe-agent-plugin-system-prompt",
      "poe-agent-plugin-web",
      "poe-agent-plugin-shell",
    ]);
  });

  it("returns an empty list for an empty config", () => {
    expect(resolvePluginsFromConfig([])).toEqual([]);
  });

  it("throws a helpful error for unknown plugin names", () => {
    expect(() =>
      resolvePluginsFromConfig([{ name: "shel" }]),
    ).toThrow('agent.plugins[0]: unknown plugin "shel"');
  });

  it("throws for duplicate plugin names", () => {
    expect(() =>
      resolvePluginsFromConfig([{ name: "web" }, { name: "web" }]),
    ).toThrow('agent.plugins[1]: duplicate plugin "web"');
  });

  it("throws for invalid plugin options and includes the config index", () => {
    expect(() =>
      resolvePluginsFromConfig([{ name: "compaction", options: { threshold: "20" } }]),
    ).toThrow("agent.plugins[0].options.threshold");
  });
});
