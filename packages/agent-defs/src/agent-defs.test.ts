import { describe, it, expect } from "vitest";
import {
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  geminiCliAgent,
  openCodeAgent,
  kimiAgent,
  gooseAgent,
  poeAgentAgent,
  allAgents,
  resolveAgentId,
  normalizeAgentId,
  type AgentDefinition
} from "./index.js";
import { parseAgentSpecifier, formatAgentSpecifier } from "./specifier.js";

const expectedAgents: AgentDefinition[] = [
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  geminiCliAgent,
  openCodeAgent,
  kimiAgent,
  gooseAgent,
  poeAgentAgent
];

const expectedProviderAgentApiShapes = new Map<string, NonNullable<AgentDefinition["apiShapes"]>>([
  ["claude-code", ["anthropic-messages"]],
  ["codex", ["openai-responses"]],
  ["gemini-cli", ["google-generations"]],
  ["kimi", ["openai-chat-completions"]],
  ["opencode", ["openai-chat-completions"]],
  ["goose", ["openai-chat-completions"]],
  ["poe-agent", ["openai-responses", "openai-chat-completions"]]
]);

const normalizeKey = (value: string): string => value.toLowerCase();

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("agent-defs package", () => {
  it("exports all agents", () => {
    expect(claudeCodeAgent).toBeDefined();
    expect(claudeDesktopAgent).toBeDefined();
    expect(codexAgent).toBeDefined();
    expect(geminiCliAgent).toBeDefined();
    expect(openCodeAgent).toBeDefined();
    expect(kimiAgent).toBeDefined();
    expect(gooseAgent).toBeDefined();
    expect(poeAgentAgent).toBeDefined();
  });

  it.each(expectedAgents)("$id has all required fields", (agent) => {
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBeTruthy();
    expect(agent.label).toBeTruthy();
    expect(agent.summary).toBeTruthy();
    expect(agent.configPath).toBeTruthy();
    expect(agent.branding.colors.dark).toBeTruthy();
    expect(agent.branding.colors.light).toBeTruthy();
    if (agent.binaryName !== undefined) {
      expect(agent.binaryName).toBeTruthy();
    }
  });

  it("exports a canonical registry", () => {
    expect(allAgents).toEqual(expectedAgents);
  });

  it("does not allow mutation of the canonical registry", () => {
    expect(() => (allAgents as AgentDefinition[]).push(codexAgent)).toThrow();
  });

  it("does not allow exported definitions to redirect binaries", () => {
    expect(() => {
      codexAgent.binaryName = "unexpected-binary";
    }).toThrow();
    expect(codexAgent.binaryName).toBe("codex");
  });

  it("has no duplicate agent ids", () => {
    const ids = allAgents.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it.each(allAgents)("$id configPath starts with ~/", (agent) => {
    expect(agent.configPath.startsWith("~/")).toBe(true);
  });

  it("declares api shapes for every provider-backed agent", () => {
    const agentsById = new Map(allAgents.map((agent) => [agent.id, agent]));

    for (const [agentId, apiShapes] of expectedProviderAgentApiShapes.entries()) {
      expect(agentsById.get(agentId)?.apiShapes).toEqual(apiShapes);
      expect(agentsById.get(agentId)?.apiShapes?.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate case-insensitive lookup keys across agents", () => {
    const keys = new Map<string, string>();

    for (const agent of allAgents) {
      const values = [agent.id, agent.name, ...(agent.aliases ?? [])];
      for (const value of values) {
        const key = normalizeKey(value);
        const existing = keys.get(key);
        if (existing && existing !== agent.id) {
          throw new Error(`Duplicate lookup key: ${value} conflicts with ${existing}`);
        }
        keys.set(key, agent.id);
      }
    }

    expect(keys.size).toBeGreaterThan(0);
  });

  it("resolves aliases case-insensitively", () => {
    expect(resolveAgentId("CLAUDE")).toBe("claude-code");
    expect(resolveAgentId("GeMiNi")).toBe("gemini-cli");
    expect(resolveAgentId("kimi-cli")).toBe("kimi");
    expect(resolveAgentId("GOOSE")).toBe("goose");
  });

  it("resolves aliases with surrounding whitespace", () => {
    expect(resolveAgentId("  CLAUDE  ")).toBe("claude-code");
  });

  it("returns undefined for unknown agents", () => {
    expect(resolveAgentId("unknown-agent")).toBeUndefined();
  });
});

describe("parseAgentSpecifier", () => {
  it("parses agent-only specifier", () => {
    expect(parseAgentSpecifier("claude-code")).toEqual({
      agent: "claude-code"
    });
  });

  it("parses agent with provider/model", () => {
    expect(parseAgentSpecifier("claude-code:anthropic/claude-opus-4.6")).toEqual({
      agent: "claude-code",
      model: "anthropic/claude-opus-4.6"
    });
  });

  it("parses codex with openai model", () => {
    expect(parseAgentSpecifier("codex:openai/gpt-5.4")).toEqual({
      agent: "codex",
      model: "openai/gpt-5.4"
    });
  });

  it("parses kimi with model", () => {
    expect(parseAgentSpecifier("kimi:novitaai/kimi-k2.5")).toEqual({
      agent: "kimi",
      model: "novitaai/kimi-k2.5"
    });
  });

  it("returns undefined model when colon is present but model is empty", () => {
    expect(parseAgentSpecifier("claude-code:")).toEqual({
      agent: "claude-code"
    });
  });

  it("does not add inherited model fields to agent-only specifiers", async () => {
    await withObjectPrototypeProperties({ model: "polluted-model" }, () => {
      const specifier = parseAgentSpecifier("claude-code");

      expect(Object.hasOwn(specifier, "model")).toBe(false);
      expect(formatAgentSpecifier(specifier)).toBe("claude-code");
    });
  });

  it("trims whitespace from agent and model", () => {
    expect(parseAgentSpecifier("  claude-code : anthropic/claude-opus-4.6  ")).toEqual({
      agent: "claude-code",
      model: "anthropic/claude-opus-4.6"
    });
  });

  it("handles model without provider prefix", () => {
    expect(parseAgentSpecifier("claude-code:claude-opus-4.6")).toEqual({
      agent: "claude-code",
      model: "claude-opus-4.6"
    });
  });
});

describe("normalizeAgentId", () => {
  it("normalizes aliases to canonical ids", () => {
    expect(normalizeAgentId("CLAUDE")).toBe("claude-code");
  });

  it("preserves inline model syntax", () => {
    expect(normalizeAgentId("claude:anthropic/claude-opus-4.6")).toBe(
      "claude-code:anthropic/claude-opus-4.6"
    );
  });

  it("returns unknown agents unchanged apart from trimming", () => {
    expect(normalizeAgentId("  custom-agent  ")).toBe("custom-agent");
  });

  it("does not append inherited models", async () => {
    await withObjectPrototypeProperties({ model: "polluted-model" }, () => {
      expect(normalizeAgentId("CLAUDE")).toBe("claude-code");
    });
  });
});

describe("formatAgentSpecifier", () => {
  it("formats agent-only", () => {
    expect(formatAgentSpecifier({ agent: "claude-code" })).toBe("claude-code");
  });

  it("formats agent with model", () => {
    expect(formatAgentSpecifier({ agent: "claude-code", model: "anthropic/claude-opus-4.6" })).toBe(
      "claude-code:anthropic/claude-opus-4.6"
    );
  });

  it("formats agent when model is undefined", () => {
    expect(formatAgentSpecifier({ agent: "codex", model: undefined })).toBe("codex");
  });

  it("formats agent-only specifiers without inherited models", async () => {
    await withObjectPrototypeProperties({ model: "polluted-model" }, () => {
      expect(formatAgentSpecifier({ agent: "codex" })).toBe("codex");
    });
  });
});
