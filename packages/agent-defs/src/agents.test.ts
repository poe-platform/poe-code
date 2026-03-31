import { describe, it, expect } from "bun:test";
import {
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent,
  allAgents,
  resolveAgentId,
  type AgentDefinition
} from "./index.js";

const expectedAgents: AgentDefinition[] = [
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent
];

const normalizeKey = (value: string): string => value.toLowerCase();

describe("agent-defs package", () => {
  it("exports all agents", () => {
    expect(claudeCodeAgent).toBeDefined();
    expect(claudeDesktopAgent).toBeDefined();
    expect(codexAgent).toBeDefined();
    expect(openCodeAgent).toBeDefined();
    expect(kimiAgent).toBeDefined();
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

  it("has no duplicate agent ids", () => {
    const ids = allAgents.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it.each(allAgents)("$id configPath starts with ~/", (agent) => {
    expect(agent.configPath.startsWith("~/")).toBe(true);
  });

  it("has no duplicate case-insensitive lookup keys across agents", () => {
    const keys = new Map<string, string>();

    for (const agent of allAgents) {
      const values = [agent.id, agent.name, ...(agent.aliases ?? [])];
      for (const value of values) {
        const key = normalizeKey(value);
        const existing = keys.get(key);
        if (existing && existing !== agent.id) {
          throw new Error(
            `Duplicate lookup key: ${value} conflicts with ${existing}`
          );
        }
        keys.set(key, agent.id);
      }
    }

    expect(keys.size).toBeGreaterThan(0);
  });

  it("resolves aliases case-insensitively", () => {
    expect(resolveAgentId("CLAUDE")).toBe("claude-code");
    expect(resolveAgentId("kimi-cli")).toBe("kimi");
  });

  it("returns undefined for unknown agents", () => {
    expect(resolveAgentId("unknown-agent")).toBeUndefined();
  });
});
