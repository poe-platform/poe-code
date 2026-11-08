import { describe, expect, it } from "vitest";
import { getResolvedPluginOptions } from "../runtime/provider-metadata.js";
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

  it("requires plugin names to be own properties", () => {
    const entry = Object.create({ name: "web" }) as { name: string };

    expect(() => resolvePluginsFromConfig([entry])).toThrow(
      "agent.plugins[0].name: must be a non-empty string.",
    );
  });

  it("ignores plugin options that are only inherited", () => {
    const entry = Object.create({ options: { cwd: "/polluted" } }) as { name: string };
    entry.name = "shell";

    const [plugin] = resolvePluginsFromConfig([entry]);

    expect(getResolvedPluginOptions(plugin!)).toEqual({});
  });
});
