import { describe, expect, it } from "vitest";
import { builtinPluginRegistry } from "./registry.js";
import { resolvePluginsFromConfig } from "./resolve-plugins.js";


describe("builtinPluginRegistry", () => {
  it("resolves the openai chat completions spec from agent.plugins config", () => {
    const plugins = resolvePluginsFromConfig([{ name: "openai-chat-completions" }]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("openai-chat-completions-plugin");
  });

  it("parses openai chat completions options", () => {
    const spec = builtinPluginRegistry.get("openai-chat-completions");

    expect(spec?.parseOptions({
      baseUrl: "https://api.poe.com/v1",
      apiKey: "test-key",
      organization: "org_123",
      defaultHeaders: {
        "x-trace-id": "trace-1"
      },
      timeout: 12_000,
      maxRetries: 3
    })).toEqual({
      baseUrl: "https://api.poe.com/v1",
      apiKey: "test-key",
      organization: "org_123",
      defaultHeaders: {
        "x-trace-id": "trace-1"
      },
      timeout: 12_000,
      maxRetries: 3
    });
  });
});
