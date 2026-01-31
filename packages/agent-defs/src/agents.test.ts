import { describe, it, expect } from "vitest";
import {
  claudeCodeAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent,
  type AgentDefinition
} from "./index.js";

const allAgents: AgentDefinition[] = [
  claudeCodeAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent
];

describe("agent-defs package", () => {
  it("exports all agents", () => {
    expect(claudeCodeAgent).toBeDefined();
    expect(codexAgent).toBeDefined();
    expect(openCodeAgent).toBeDefined();
    expect(kimiAgent).toBeDefined();
  });

  it.each(allAgents)("$id has all required fields", (agent) => {
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBeTruthy();
    expect(agent.label).toBeTruthy();
    expect(agent.summary).toBeTruthy();
    expect(agent.binaryName).toBeTruthy();
    expect(agent.configPath).toBeTruthy();
    expect(agent.branding.colors.dark).toBeTruthy();
    expect(agent.branding.colors.light).toBeTruthy();
  });

  it("has no duplicate agent ids", () => {
    const ids = allAgents.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it.each(allAgents)("$id configPath starts with ~/", (agent) => {
    expect(agent.configPath.startsWith("~/")).toBe(true);
  });
});
