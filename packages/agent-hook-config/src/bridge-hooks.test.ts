import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

vi.mock("./configs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./configs.js")>();
  const codexConfig = actual.getAgentConfig("codex")!;

  return {
    ...actual,
    resolveAgentSupport(input: string) {
      if (input === "no-local") {
        return {
          status: "supported" as const,
          input,
          id: input,
          config: { ...codexConfig, localHookPath: undefined }
        };
      }

      return actual.resolveAgentSupport(input);
    }
  };
});

const { bridgeHooks, cleanupBridgedHooks } = await import("./index.js");
const { setGitDirRunnerForTest } = await import("../../agent-skill-config/src/git-exclude.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const runId = "bridge-run";
const sourcePath = path.join(cwd, ".claude/settings.json");
const userSourcePath = path.join(homeDir, ".claude/settings.json");
const targetPath = path.join(cwd, ".codex/hooks.json");
const identityPath = sourcePath;
const excludePath = path.join(cwd, ".git/info/exclude");

function sourceHooks(hooks: Record<string, unknown>): void {
  vol.mkdirSync(path.dirname(sourcePath), { recursive: true });
  vol.writeFileSync(sourcePath, JSON.stringify({ hooks }));
}

function readTarget(): { hooks: Record<string, Array<{ matcher?: string; hooks: unknown[] }>> } {
  return JSON.parse(vol.readFileSync(targetPath, "utf8") as string);
}

describe("bridgeHooks", () => {
  let restoreRunner: (() => void) | undefined;

  beforeEach(() => {
    restoreRunner?.();
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    restoreRunner = setGitDirRunnerForTest(() => path.join(cwd, ".git"));
  });

  afterEach(() => {
    restoreRunner?.();
    vi.restoreAllMocks();
  });

  it("transforms a Claude project command hook into generated Codex hooks", () => {
    sourceHooks({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }]
    });

    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, runId, {
      scope: "project"
    });

    expect(manifest).toMatchObject({
      sourceAgentId: "claude-code",
      targetAgentId: "codex",
      strategy: "transform",
      writtenPath: targetPath,
      generatedEntryIds: ["generated-bridge-run-0"],
      drops: []
    });
    expect(readTarget().hooks.PreToolUse[0]?.hooks).toEqual([
      {
        type: "command",
        command: "npm test",
        statusMessage: "[generated:poe-code:bridge-run] "
      }
    ]);
  });

  it("reads user and project hooks by default", () => {
    vol.mkdirSync(path.dirname(userSourcePath), { recursive: true });
    vol.writeFileSync(
      userSourcePath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "from-user" }] }] } })
    );
    sourceHooks({ Stop: [{ hooks: [{ type: "command", command: "from-project" }] }] });

    bridgeHooks("claude-code", "codex", cwd, homeDir, runId);

    expect(readTarget().hooks.Stop[0]?.hooks).toMatchObject([
      { command: "from-user" },
      { command: "from-project" }
    ]);
  });

  it("reports dropped unsupported events without writing an entry", () => {
    sourceHooks({ SessionEnd: [{ hooks: [{ type: "command", command: "notify" }] }] });

    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, runId, {
      scope: "project"
    });

    expect(manifest.drops).toHaveLength(1);
    expect(manifest.drops[0]?.source.event).toBe("SessionEnd");
    expect(readTarget()).toEqual({ hooks: {} });
  });

  it("drops http handlers while retaining command peers", () => {
    sourceHooks({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "http", url: "https://example.test/hook" },
            { type: "command", command: "npm test" }
          ]
        }
      ]
    });

    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, runId, {
      scope: "project"
    });

    expect(manifest.drops[0]).toMatchObject({ reason: "unsupported-handler-type" });
    expect(manifest.drops[0]?.detail).toContain("http");
    expect(readTarget().hooks.PreToolUse[0]?.hooks).toHaveLength(1);
  });

  it("rewrites Claude project placeholders in output commands", () => {
    sourceHooks({
      PreToolUse: [
        { hooks: [{ type: "command", command: "cd ${CLAUDE_PROJECT_DIR} && npm test" }] }
      ]
    });

    bridgeHooks("claude-code", "codex", cwd, homeDir, runId, { scope: "project" });

    expect(readTarget().hooks.PreToolUse[0]?.hooks[0]).toMatchObject({
      command: "cd $(git rev-parse --show-toplevel) && npm test"
    });
  });

  it("uses a symlink for identical hook formats", () => {
    const manifest = bridgeHooks("claude-code", "claude-code", cwd, homeDir, runId);

    expect(manifest).toMatchObject({
      strategy: "symlink",
      symlinkPath: identityPath,
      symlinkTarget: identityPath,
      symlinkReplaced: "none"
    });
    expect(fs.lstatSync(identityPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(identityPath)).toBe(identityPath);
    expect(vol.readFileSync(excludePath, "utf8") as string).toContain(".claude/settings.json");
  });

  it("throws specifically for unknown source and target agents", () => {
    expect(() => bridgeHooks("bad-source", "codex", cwd, homeDir, runId)).toThrow(
      'Unsupported source hook agent "bad-source". Supported hook agents: claude-code, codex.'
    );
    expect(() => bridgeHooks("claude-code", "bad-target", cwd, homeDir, runId)).toThrow(
      'Unsupported target hook agent "bad-target". Supported hook agents: claude-code, codex.'
    );
  });

  it("throws when the target cannot accept project-local hooks", () => {
    sourceHooks({ PreToolUse: [{ hooks: [{ type: "command", command: "npm test" }] }] });

    expect(() => bridgeHooks("claude-code", "no-local", cwd, homeDir, runId)).toThrow(
      /no-local.*project/i
    );
  });

  it("rejects a forced transform when no target writer supports the format", () => {
    sourceHooks({ PreToolUse: [{ hooks: [{ type: "command", command: "npm test" }] }] });

    expect(() =>
      bridgeHooks("claude-code", "claude-code", cwd, homeDir, runId, {
        strategy: "transform",
        scope: "project"
      })
    ).toThrow(/transform.*claude-code.*codex/i);
    expect(vol.existsSync(identityPath)).toBe(true);
  });

  it("cleans only this transform run and preserves user hooks", () => {
    vol.mkdirSync(path.dirname(targetPath), { recursive: true });
    vol.writeFileSync(
      targetPath,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user" }] }] }
      })
    );
    sourceHooks({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "generated" }] }]
    });
    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, runId, {
      scope: "project"
    });
    const fileWithConcurrentRun = readTarget();
    fileWithConcurrentRun.hooks.PreToolUse[0]?.hooks.push({
      type: "command",
      command: "other-generated",
      statusMessage: "[generated:poe-code:other-run] "
    });
    vol.writeFileSync(targetPath, JSON.stringify(fileWithConcurrentRun));

    cleanupBridgedHooks(manifest);

    expect(readTarget()).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "user" },
              {
                type: "command",
                command: "other-generated",
                statusMessage: "[generated:poe-code:other-run] "
              }
            ]
          }
        ]
      }
    });
  });

  it("rolls back generated hooks when exclude bookkeeping fails", () => {
    sourceHooks({ Stop: [{ hooks: [{ type: "command", command: "generated" }] }] });
    const writeFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      if (String(filePath) === excludePath) {
        throw new Error("exclude write failed");
      }
      return writeFileSync(filePath, data, options);
    });

    expect(() => bridgeHooks("claude-code", "codex", cwd, homeDir, runId, { scope: "project" })).toThrow(
      "exclude write failed"
    );
    expect(vol.existsSync(targetPath)).toBe(false);
  });

  it("preserves the hook file when cleanup rewrite fails", () => {
    vol.mkdirSync(path.dirname(targetPath), { recursive: true });
    vol.writeFileSync(targetPath, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "user" }] }] } }));
    sourceHooks({ Stop: [{ hooks: [{ type: "command", command: "generated" }] }] });
    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, runId, { scope: "project" });
    const original = vol.readFileSync(targetPath, "utf8") as string;
    const renameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === targetPath) {
        throw new Error("cleanup rename failed");
      }
      renameSync(from, to);
    });

    expect(() => cleanupBridgedHooks(manifest)).toThrow("cleanup rename failed");
    expect(vol.readFileSync(targetPath, "utf8")).toBe(original);
  });

  it("removes a bridge symlink only while it still targets its source", () => {
    const manifest = bridgeHooks("claude-code", "claude-code", cwd, homeDir, runId);
    cleanupBridgedHooks(manifest);
    expect(vol.existsSync(identityPath)).toBe(false);
    expect(vol.existsSync(path.dirname(identityPath))).toBe(false);

    const replaced = bridgeHooks("claude-code", "claude-code", cwd, homeDir, "second");
    fs.unlinkSync(identityPath);
    vol.mkdirSync(path.dirname(identityPath), { recursive: true });
    vol.symlinkSync("/other/settings.json", identityPath);
    cleanupBridgedHooks(replaced);
    expect(fs.readlinkSync(identityPath)).toBe("/other/settings.json");
  });

  it("leaves a regular file that replaces a bridge symlink", () => {
    const manifest = bridgeHooks("claude-code", "claude-code", cwd, homeDir, runId);
    fs.unlinkSync(identityPath);
    vol.writeFileSync(identityPath, "user settings");

    cleanupBridgedHooks(manifest);

    expect(vol.readFileSync(identityPath, "utf8")).toBe("user settings");
  });

  it("cleans idempotently and removes only its exclude block", () => {
    sourceHooks({ PreToolUse: [{ hooks: [{ type: "command", command: "npm test" }] }] });
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      "# poe-code-spawn-hooks:other begin\n.codex/other.json\n# poe-code-spawn-hooks:other end\n"
    );
    const manifest = bridgeHooks("claude-code", "codex", cwd, homeDir, runId, {
      scope: "project"
    });

    expect(vol.readFileSync(excludePath, "utf8") as string).toContain(".codex/hooks.json");
    expect(vol.readFileSync(excludePath, "utf8") as string).toContain(
      "# poe-code-spawn-hooks:bridge-run begin"
    );

    cleanupBridgedHooks(manifest);
    cleanupBridgedHooks(manifest);

    const exclude = vol.readFileSync(excludePath, "utf8") as string;
    expect(exclude).not.toContain("bridge-run");
    expect(exclude).toContain("# poe-code-spawn-hooks:other begin");
    expect(vol.existsSync(path.dirname(targetPath))).toBe(false);
  });
});
