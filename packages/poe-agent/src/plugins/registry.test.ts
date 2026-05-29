import { describe, expect, it } from "vitest";
import { builtinPluginRegistry } from "./registry.js";
import { resolvePluginsFromConfig } from "./resolve-plugins.js";

describe("builtinPluginRegistry", () => {
  it("prevents consumers from replacing built-in factories", () => {
    const spec = builtinPluginRegistry.get("web");
    expect(spec).toBeDefined();

    expect(() => {
      spec!.factory = () => ({ name: "replaced-web-plugin" });
    }).toThrow();
    expect(resolvePluginsFromConfig([{ name: "web" }])[0]?.name).toBe(
      "poe-agent-plugin-web"
    );
  });

  it("resolves the openai responses spec from agent.plugins config", () => {
    const plugins = resolvePluginsFromConfig([{ name: "openai-responses" }]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("openai-responses-plugin");
  });

  it("resolves the openai chat completions spec from agent.plugins config", () => {
    const plugins = resolvePluginsFromConfig([{ name: "openai-chat-completions" }]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("openai-chat-completions-plugin");
  });

  it("parses openai responses options", () => {
    const spec = builtinPluginRegistry.get("openai-responses");

    expect(
      spec?.parseOptions({
        baseUrl: "https://api.poe.com/v1",
        apiKey: "test-key",
        organization: "org_123",
        project: "proj_123",
        defaultHeaders: {
          "x-trace-id": "trace-1"
        },
        timeout: 12_000,
        maxRetries: 3,
        reasoningEffort: "high",
        reasoningSummary: "concise",
        include: ["reasoning.encrypted_content", "message.output_text.logprobs"]
      })
    ).toEqual({
      baseUrl: "https://api.poe.com/v1",
      apiKey: "test-key",
      organization: "org_123",
      project: "proj_123",
      defaultHeaders: {
        "x-trace-id": "trace-1"
      },
      timeout: 12_000,
      maxRetries: 3,
      reasoningEffort: "high",
      reasoningSummary: "concise",
      include: ["reasoning.encrypted_content", "message.output_text.logprobs"]
    });
  });

  it("parses openai chat completions options", () => {
    const spec = builtinPluginRegistry.get("openai-chat-completions");

    expect(
      spec?.parseOptions({
        baseUrl: "https://api.poe.com/v1",
        apiKey: "test-key",
        organization: "org_123",
        defaultHeaders: {
          "x-trace-id": "trace-1"
        },
        timeout: 12_000,
        maxRetries: 3
      })
    ).toEqual({
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
