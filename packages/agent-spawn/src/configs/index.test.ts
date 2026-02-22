import { describe, it, expect } from "vitest";
import {
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn
} from "./index.js";

describe("configs/getSpawnConfig", () => {
  it("returns undefined for claude-desktop", () => {
    expect(getSpawnConfig("claude-desktop")).toBeUndefined();
  });
});

describe("configs/mcp support", () => {
  it("reports spawn-time MCP support for configured agents", () => {
    expect(supportsMcpAtSpawn("claude-code")).toBe(true);
    expect(supportsMcpAtSpawn("codex")).toBe(true);
    expect(supportsMcpAtSpawn("kimi")).toBe(true);
    expect(supportsMcpAtSpawn("opencode")).toBe(false);
  });

  it("supports aliases and unknown agents safely", () => {
    expect(supportsMcpAtSpawn("claude")).toBe(true);
    expect(supportsMcpAtSpawn("not-a-real-agent")).toBe(false);
  });

  it("lists MCP-capable agents", () => {
    expect(listMcpSupportedAgents()).toEqual(["claude-code", "codex", "kimi"]);
  });
});
