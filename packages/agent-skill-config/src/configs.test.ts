import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "bun:test";
import {
  getAgentConfig,
  resolveAgentSupport,
  resolveSkillDir,
  supportedAgents
} from "./configs.js";

describe("supportedAgents", () => {
  it("includes supported agent ids", () => {
    expect(supportedAgents).toEqual(["claude-code", "codex", "opencode"]);
  });
});

describe("resolveAgentSupport", () => {
  it("returns supported for direct agent id", () => {
    const result = resolveAgentSupport("claude-code");
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
    expect(result.config).toEqual({
      globalSkillDir: "~/.claude/skills",
      localSkillDir: ".claude/skills"
    });
  });

  it("returns supported for aliases resolved via resolveAgentId", () => {
    const result = resolveAgentSupport("CLAUDE");
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
  });

  it("returns unknown when no agent matches", () => {
    const result = resolveAgentSupport("unknown");
    expect(result).toEqual({ status: "unknown", input: "unknown" });
  });
});

describe("getAgentConfig", () => {
  it("returns config for supported agent id", () => {
    expect(getAgentConfig("codex")).toEqual({
      globalSkillDir: "~/.codex/skills",
      localSkillDir: ".codex/skills"
    });
  });

  it("returns undefined for unknown input", () => {
    expect(getAgentConfig("unknown")).toBeUndefined();
  });
});

describe("resolveSkillDir", () => {
  it("resolves local path relative to cwd", () => {
    const config = getAgentConfig("claude-code");
    expect(config).toBeDefined();

    const cwd = "/repo";
    const result = resolveSkillDir(config!, "local", cwd);
    expect(result).toBe(path.resolve(cwd, ".claude/skills"));
  });

  it("resolves global path relative to the home directory", () => {
    const config = getAgentConfig("opencode");
    expect(config).toBeDefined();

    const result = resolveSkillDir(config!, "global", "/repo");
    expect(result).toBe(path.resolve(path.join(os.homedir(), ".config/opencode/skills")));
  });
});

