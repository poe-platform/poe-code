import { describe, it, expect } from "vitest";
import {
  getAcpSpawnConfig,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn
} from "./index.js";
import { codexSpawnConfig } from "./codex.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { openCodeSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig } from "./kimi.js";
import { gooseSpawnConfig, gooseAcpSpawnConfig } from "./goose.js";
import { geminiCliAcpSpawnConfig } from "./gemini-cli.js";
import { serializeGooseMcpArgs } from "./mcp.js";

describe("configs/getSpawnConfig", () => {
  it("returns undefined for claude-desktop", () => {
    expect(getSpawnConfig("claude-desktop")).toBeUndefined();
  });
});

describe("configs/mcp support", () => {
  it("reports spawn-time MCP support for configured agents", () => {
    expect(supportsMcpAtSpawn("claude-code")).toBe(true);
    expect(supportsMcpAtSpawn("codex")).toBe(true);
    expect(supportsMcpAtSpawn("goose")).toBe(true);
    expect(supportsMcpAtSpawn("kimi")).toBe(true);
    expect(supportsMcpAtSpawn("opencode")).toBe(true);
  });

  it("supports aliases and unknown agents safely", () => {
    expect(supportsMcpAtSpawn("claude")).toBe(true);
    expect(supportsMcpAtSpawn("not-a-real-agent")).toBe(false);
  });

  it("lists MCP-capable agents", () => {
    expect(listMcpSupportedAgents()).toEqual([
      "claude-code",
      "codex",
      "opencode",
      "kimi",
      "goose"
    ]);
  });
});

describe("configs/getAcpSpawnConfig", () => {
  it("returns the registered ACP config for goose", () => {
    expect(getAcpSpawnConfig("goose")).toEqual(gooseAcpSpawnConfig);
  });

  it("returns the registered ACP config for Gemini CLI", () => {
    expect(getAcpSpawnConfig("gemini")).toEqual(geminiCliAcpSpawnConfig);
  });
});

describe("resume.args (in-spawn injection)", () => {
  const threadId = "thread_abc123";
  const cwd = "/projects/demo";

  it("codex injects exec sub-subcommand resume", () => {
    expect(codexSpawnConfig.resume!.args(threadId, cwd)).toEqual(["resume", threadId]);
    expect(codexSpawnConfig.resume!.position).toBe("beforePrompt");
  });

  it("claude-code injects --resume flag with threadId", () => {
    expect(claudeCodeSpawnConfig.resume!.args(threadId, cwd)).toEqual(["--resume", threadId]);
  });

  it("opencode injects --session flag with threadId", () => {
    expect(openCodeSpawnConfig.resume!.args(threadId, cwd)).toEqual(["--session", threadId]);
  });

  it("kimi injects --session and --work-dir flags", () => {
    expect(kimiSpawnConfig.resume!.args(threadId, cwd)).toEqual([
      "--session",
      threadId,
      "--work-dir",
      cwd
    ]);
  });

  it("goose injects --resume with --session-id", () => {
    expect(gooseSpawnConfig.resume!.args(threadId, cwd)).toEqual([
      "--resume",
      "--session-id",
      threadId
    ]);
  });
});

describe("resume.hintArgs (printed shell hint)", () => {
  const threadId = "thread_abc123";
  const cwd = "/projects/demo";

  it("codex hint uses top-level interactive resume with -C", () => {
    expect(codexSpawnConfig.resume!.hintArgs!(threadId, cwd)).toEqual([
      "resume",
      "-C",
      cwd,
      threadId
    ]);
  });

  it("opencode hint uses top-level positional cwd with --session", () => {
    expect(openCodeSpawnConfig.resume!.hintArgs!(threadId, cwd)).toEqual([
      cwd,
      "--session",
      threadId
    ]);
  });

  it("goose hint uses run subcommand with --session-id and a continue prompt", () => {
    expect(gooseSpawnConfig.resume!.hintArgs!(threadId, cwd)).toEqual([
      "run",
      "--resume",
      "--session-id",
      threadId,
      "--text",
      "continue"
    ]);
  });

  it("claude-code falls back to args when hintArgs is omitted", () => {
    expect(claudeCodeSpawnConfig.resume!.hintArgs).toBeUndefined();
  });

  it("kimi falls back to args when hintArgs is omitted", () => {
    expect(kimiSpawnConfig.resume!.hintArgs).toBeUndefined();
  });
});

describe("serializeGooseMcpArgs", () => {
  it("serializes runtime MCP servers as repeated --with-extension args", () => {
    expect(
      serializeGooseMcpArgs({
        alpha: {
          command: "uvx",
          args: ["mcp-server-alpha", "--port", "3000"]
        },
        beta: {
          command: "node"
        }
      })
    ).toEqual([
      "--with-extension",
      "uvx mcp-server-alpha --port 3000",
      "--with-extension",
      "node"
    ]);
  });
});
