import { describe, it, expect } from "vitest";
import {
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn
} from "./index.js";
import { codexSpawnConfig } from "./codex.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { openCodeSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig } from "./kimi.js";

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
    expect(supportsMcpAtSpawn("opencode")).toBe(true);
  });

  it("supports aliases and unknown agents safely", () => {
    expect(supportsMcpAtSpawn("claude")).toBe(true);
    expect(supportsMcpAtSpawn("not-a-real-agent")).toBe(false);
  });

  it("lists MCP-capable agents", () => {
    expect(listMcpSupportedAgents()).toEqual(["claude-code", "codex", "opencode", "kimi"]);
  });
});

describe("resumeCommand", () => {
  const threadId = "thread_abc123";
  const cwd = "/projects/demo";

  it("codex returns resume subcommand with -C flag", () => {
    expect(codexSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      "resume",
      "-C",
      cwd,
      threadId
    ]);
  });

  it("claude-code returns --resume flag with threadId", () => {
    expect(claudeCodeSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      "--resume",
      threadId
    ]);
  });

  it("opencode returns positional cwd with --session flag", () => {
    expect(openCodeSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      cwd,
      "--session",
      threadId
    ]);
  });

  it("kimi returns --session and --work-dir flags", () => {
    expect(kimiSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      "--session",
      threadId,
      "--work-dir",
      cwd
    ]);
  });
});
