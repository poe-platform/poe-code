import { describe, it, expect } from "vitest";
import {
  allSpawnConfigs,
  getAcpSpawnConfig,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn,
  supportsSpawnMode
} from "./index.js";
import { codexSpawnConfig } from "./codex.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { openCodeSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig } from "./kimi.js";
import { gooseSpawnConfig, gooseAcpSpawnConfig } from "./goose.js";
import { geminiCliAcpSpawnConfig } from "./gemini-cli.js";
import { cursorSpawnConfig } from "./cursor.js";
import { serializeCodexMcpArgs, serializeGooseMcpArgs, serializeOpenCodeMcpEnv } from "./mcp.js";

describe("configs/getSpawnConfig", () => {
  it("returns undefined for claude-desktop", () => {
    expect(getSpawnConfig("claude-desktop")).toBeUndefined();
  });

  it("does not allow returned config mutations to affect future spawns", () => {
    const config = getSpawnConfig("codex");

    expect(config?.kind).toBe("cli");
    if (!config || config.kind !== "cli") {
      throw new Error("Expected Codex CLI config");
    }

    expect(() => config.defaultArgs.push("--unexpected-mutated-flag")).toThrow();
    expect(() => config.modes.yolo.push("--unexpected-mode-flag")).toThrow();
    expect(config.defaultArgs).not.toContain("--unexpected-mutated-flag");
    expect(config.modes.yolo).not.toContain("--unexpected-mode-flag");
  });

  it("publishes immutable registry configuration", () => {
    expect(Object.isFrozen(allSpawnConfigs)).toBe(true);
    expect(Object.isFrozen(allSpawnConfigs[0])).toBe(true);
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
      "cursor",
      "opencode",
      "kimi",
      "goose"
    ]);
  });

  it("builds Cursor arguments and transforms only Poe-style Claude ids", async () => {
    const { buildSpawnArgs } = await import("../spawn.js");
    expect(getSpawnConfig("cursor-agent")).toBe(cursorSpawnConfig);
    expect(buildSpawnArgs("cursor", {
      prompt: "hello",
      model: "anthropic/claude-opus-4.7",
      mode: "read",
      resumeThreadId: "session-1"
    }).args).toEqual([
      "--output-format", "stream-json", "--trust", "--approve-mcps",
      "-p", "--resume", "session-1", "hello", "--model", "claude-opus-4-7",
      "--mode", "plan"
    ]);
    expect(buildSpawnArgs("cursor", {
      prompt: "hello",
      model: "claude-4.5-sonnet-thinking",
      mode: "edit"
    }).args).toContain("claude-4.5-sonnet-thinking");
  });

  it("omits Cursor's prompt when stdin is requested", async () => {
    const { buildSpawnArgs } = await import("../spawn.js");
    expect(buildSpawnArgs("cursor", { prompt: "secret", useStdin: true }).args).not.toContain("secret");
    expect(supportsMcpAtSpawn("cursor")).toBe(true);
  });
});

describe("configs/auto mode", () => {
  it("defines auto only for agents with a usable noninteractive approval mode", () => {
    expect(claudeCodeSpawnConfig.modes.auto).toEqual(["--permission-mode", "auto"]);
    expect(codexSpawnConfig.modes.auto).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(cursorSpawnConfig.modes.auto).toBeUndefined();
    expect(openCodeSpawnConfig.modes.auto).toBeUndefined();
    expect(kimiSpawnConfig.modes.auto).toBeUndefined();
    expect(gooseSpawnConfig.modes.auto).toBeUndefined();
  });

  it("reports mode support from the spawn config", () => {
    expect(supportsSpawnMode("claude-code", "auto")).toBe(true);
    expect(supportsSpawnMode("claude", "auto")).toBe(true);
    expect(supportsSpawnMode("codex", "auto")).toBe(true);
    expect(supportsSpawnMode("codex", "edit")).toBe(true);
    expect(supportsSpawnMode("goose", "auto")).toBe(false);
    // ACP and custom spawn paths accept every mode.
    expect(supportsSpawnMode("gemini", "auto")).toBe(true);
  });

  it("maps codex yolo to the native bypass flag instead of sandbox selection", () => {
    expect(codexSpawnConfig.modes.yolo).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("maps gemini ACP approval mode from the spawn mode", () => {
    const acpArgs = geminiCliAcpSpawnConfig.acpArgs;
    if (typeof acpArgs !== "function") {
      throw new Error("Expected gemini acpArgs to be a function");
    }
    expect(acpArgs({})).toEqual(["--acp", "--approval-mode", "yolo"]);
    expect(acpArgs({ mode: "yolo" })).toEqual(["--acp", "--approval-mode", "yolo"]);
    expect(acpArgs({ mode: "auto" })).toEqual(["--acp", "--approval-mode", "default"]);
    expect(acpArgs({ mode: "edit" })).toEqual(["--acp", "--approval-mode", "auto_edit"]);
    expect(acpArgs({ mode: "read" })).toEqual(["--acp", "--approval-mode", "plan"]);
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

  it("rejects Goose MCP servers with env overrides because the CLI arg cannot preserve them", () => {
    expect(() =>
      serializeGooseMcpArgs({
        alpha: {
          command: "uvx",
          env: { MCP_LOG_LEVEL: "debug" }
        }
      })
    ).toThrow('Goose MCP server "alpha" does not support env through --with-extension.');
  });

  it("rejects Goose MCP servers with timeouts because the CLI arg cannot preserve them", () => {
    expect(() =>
      serializeGooseMcpArgs({
        alpha: {
          command: "uvx",
          timeout: 30
        }
      })
    ).toThrow('Goose MCP server "alpha" does not support timeout through --with-extension.');
  });
});

describe("configs/MCP serialization", () => {
  it("auto-approves explicitly configured Codex MCP servers by default", () => {
    expect(serializeCodexMcpArgs({ slack: { command: "slack-mcp" } })).toEqual([
      "-c",
      'mcp_servers.slack.command="slack-mcp"',
      "-c",
      'mcp_servers.slack.default_tools_approval_mode="approve"'
    ]);
  });

  it("allows Codex MCP auto-approval to be disabled", () => {
    expect(
      serializeCodexMcpArgs({ slack: { command: "slack-mcp", autoApprove: false } })
    ).toEqual(["-c", 'mcp_servers.slack.command="slack-mcp"']);
  });

  it("quotes Codex MCP server names that are not valid TOML bare keys", () => {
    expect(
      serializeCodexMcpArgs({
        "team.search": { command: "search-mcp" },
        "local tools": { command: "tools-mcp" }
      })
    ).toEqual([
      "-c",
      'mcp_servers."team.search".command="search-mcp"',
      "-c",
      'mcp_servers."team.search".default_tools_approval_mode="approve"',
      "-c",
      'mcp_servers."local tools".command="tools-mcp"',
      "-c",
      'mcp_servers."local tools".default_tools_approval_mode="approve"'
    ]);
  });

  it("preserves special MCP server names in Kimi JSON arguments", () => {
    const args = kimiSpawnConfig.mcpArgs!(
      JSON.parse('{"__proto__":{"command":"custom-server"}}')
    );
    const serialized = JSON.parse(args[1]!) as { mcpServers: Record<string, unknown> };

    expect(Object.hasOwn(serialized.mcpServers, "__proto__")).toBe(true);
  });

  it("preserves special MCP server names in OpenCode environment config", () => {
    const env = serializeOpenCodeMcpEnv(
      JSON.parse('{"__proto__":{"command":"custom-server"}}')
    );
    const serialized = JSON.parse(env.OPENCODE_CONFIG_CONTENT) as {
      mcp: Record<string, unknown>;
    };

    expect(Object.hasOwn(serialized.mcp, "__proto__")).toBe(true);
  });

  it("rejects OpenCode MCP server timeouts because the environment config cannot preserve them", () => {
    expect(() =>
      serializeOpenCodeMcpEnv({
        slow: { command: "node", timeout: 45 }
      })
    ).toThrow('OpenCode MCP server "slow" does not support timeout.');
  });
});
