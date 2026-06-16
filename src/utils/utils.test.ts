import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "./file-system.js";
import { createBackup, restoreLatestBackup } from "./backup.js";
import { createMockFs } from "@poe-code/config-mutations/testing";
import {
  extractSettingsFromArgs,
  mergeCliSettings,
  buildArgsWithMergedSettings
} from "./cli-settings-merge.js";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck,
  createSpawnHealthCheck,
  stdoutMatchesExpected
} from "./command-checks.js";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import {
  renderUnifiedDiff,
  formatDryRunOperations,
  createDryRunFileSystem,
  DryRunRecorder
} from "./dry-run.js";
import {
  detectExecutionContext,
  formatCliHelpCommand,
  formatCliUsageCommand,
  toMcpServerCommand,
  toOpenCodeMcpCommand
} from "./execution-context.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

// ── backup ────────────────────────────────────────────────────────────────────

describe("backup utilities", () => {
  let fs: FileSystem;
  const root = "/home/user";
  const filePath = path.join(root, ".bashrc");

  beforeEach(async () => {
    fs = createMockFs({ [filePath]: "export FOO=bar" }, root);
  });

  it("creates timestamped backup when file exists", async () => {
    const backupPath = await createBackup(fs, filePath, () => "20240101T010101");

    expect(backupPath).toBe(`${filePath}.backup.20240101T010101`);
    const backupContent = await fs.readFile(backupPath!, "utf8");
    expect(backupContent).toBe("export FOO=bar");
  });

  it("does not write a backup through a preexisting symlink", async () => {
    const backupPath = `${filePath}.backup.20240101T010101`;
    const volume = Volume.fromJSON({
      [filePath]: "export FOO=bar",
      "/outside.backup": "outside-state\n"
    });
    volume.symlinkSync("/outside.backup", backupPath);
    fs = {
      ...(createFsFromVolume(volume).promises as unknown as FileSystem),
      copyFile: undefined
    };

    await expect(createBackup(fs, filePath, () => "20240101T010101")).rejects.toMatchObject({
      code: "EEXIST"
    });
    await expect(fs.readFile("/outside.backup", "utf8")).resolves.toBe("outside-state\n");
  });

  it("cleans a partial backup when backup creation fails", async () => {
    const baseFs = fs;
    let backupPath: string | undefined;
    fs = {
      ...baseFs,
      copyFile: undefined,
      writeFile: async (target, data, options) => {
        if (target.includes(".backup.")) {
          backupPath = target;
          await baseFs.writeFile(target, "partial backup", options);
          throw new Error("backup write failed");
        }

        await baseFs.writeFile(target, data, options);
      }
    };

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(createBackup(fs, filePath, () => "20240101T010101")).rejects.toThrow(
        "backup write failed"
      );
    });
    expect(backupPath).toBeDefined();
    await expect(baseFs.readFile(backupPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("skips backup when file is missing", async () => {
    await fs.unlink(filePath);

    const backupPath = await createBackup(fs, filePath, () => "20240101T010101");
    expect(backupPath).toBeNull();
  });

  it("restores most recent backup", async () => {
    await createBackup(fs, filePath, () => "20240101T010101");
    await fs.writeFile(filePath, "changed", { encoding: "utf8" });
    await createBackup(fs, filePath, () => "20240201T020202");
    await fs.writeFile(filePath, "changed again", { encoding: "utf8" });

    const restored = await restoreLatestBackup(fs, filePath);
    expect(restored).toBe(true);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("changed");
  });

  it("returns false when no backups exist", async () => {
    await fs.unlink(filePath);
    const restored = await restoreLatestBackup(fs, filePath);
    expect(restored).toBe(false);
  });

  it("ignores prefixed sibling files that are not timestamped backups", async () => {
    await createBackup(fs, filePath, () => "20240101T010101");
    await fs.writeFile(`${filePath}.backup.zzz-not-a-backup`, "unrelated", { encoding: "utf8" });
    await fs.writeFile(filePath, "changed", { encoding: "utf8" });

    await expect(restoreLatestBackup(fs, filePath)).resolves.toBe(true);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("export FOO=bar");
  });

  it("preserves live content when restoring backup bytes fails", async () => {
    await createBackup(fs, filePath, () => "20240101T010101");
    await fs.writeFile(filePath, "current valid content", { encoding: "utf8" });
    const baseFs = fs;
    let temporaryPath: string | undefined;
    fs = {
      ...baseFs,
      copyFile: undefined,
      writeFile: async (target, data, options) => {
        if (target.includes(".restore-")) {
          temporaryPath = target;
          await baseFs.writeFile(target, "partial restored bytes", options);
          throw new Error("replacement write failed");
        }
        await baseFs.writeFile(target, data, options);
      }
    };

    await expect(restoreLatestBackup(fs, filePath)).rejects.toThrow("replacement write failed");
    await expect(baseFs.readFile(filePath, "utf8")).resolves.toBe("current valid content");
    expect(temporaryPath).toBeDefined();
    await expect(baseFs.readFile(temporaryPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not remove a colliding restore temp symlink", async () => {
    const volume = Volume.fromJSON({
      [filePath]: "current valid content",
      [`${filePath}.backup.20240101T010101`]: "restored content",
      "/outside.tmp": "outside-state\n"
    });
    const baseFs = createFsFromVolume(volume).promises as unknown as FileSystem;
    let temporaryPath: string | undefined;
    fs = {
      ...baseFs,
      copyFile: undefined,
      async writeFile(target, data, options) {
        if (temporaryPath === undefined && target.includes(".restore-")) {
          temporaryPath = target;
          volume.symlinkSync("/outside.tmp", target);
          expect(options).toEqual({ flag: "wx" });
        }

        await baseFs.writeFile(target, data, options);
      }
    };

    await expect(restoreLatestBackup(fs, filePath)).rejects.toThrow();

    expect(temporaryPath).toBeDefined();
    expect(volume.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(temporaryPath as string).isSymbolicLink()).toBe(true);
    await expect(baseFs.readFile(filePath, "utf8")).resolves.toBe("current valid content");
  });
});

// ── cli-settings-merge ────────────────────────────────────────────────────────

describe("cli-settings-merge", () => {
  describe("extractSettingsFromArgs", () => {
    it("returns null settings when --settings not present", () => {
      const args = ["-p", "query", "--model", "opus"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toBeNull();
      expect(result.argsWithoutSettings).toEqual(args);
    });

    it("extracts JSON settings from args", () => {
      const args = ["-p", "--settings", '{"model":"opus"}', "query"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({ model: "opus" });
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("handles --settings at end of args", () => {
      const args = ["-p", "query", "--settings", '{"verbose":true}'];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({ verbose: true });
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("handles --settings at start of args", () => {
      const args = ["--settings", '{"model":"sonnet"}', "-p", "query"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({ model: "sonnet" });
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("returns null for file path settings (non-JSON)", () => {
      const args = ["-p", "--settings", "./settings.json", "query"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toBeNull();
      expect(result.settingsFilePath).toBe("./settings.json");
      expect(result.argsWithoutSettings).toEqual(["-p", "query"]);
    });

    it("handles --settings without value", () => {
      const args = ["-p", "query", "--settings"];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toBeNull();
      expect(result.argsWithoutSettings).toEqual(args);
    });

    it("extracts nested settings objects", () => {
      const args = ["--settings", '{"env":{"MY_VAR":"foo"},"model":"opus"}'];
      const result = extractSettingsFromArgs(args);

      expect(result.userSettings).toEqual({
        env: { MY_VAR: "foo" },
        model: "opus"
      });
    });
  });

  describe("mergeCliSettings", () => {
    it("returns required settings when user settings is null", () => {
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(null, required);

      expect(result).toEqual(required);
    });

    it("preserves user settings not in required", () => {
      const user = { model: "opus", verbose: true };
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        model: "opus",
        verbose: true,
        apiKeyHelper: "echo $KEY"
      });
    });

    it("required settings override user settings", () => {
      const user = { apiKeyHelper: "my-script.sh", model: "opus" };
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        model: "opus",
        apiKeyHelper: "echo $KEY"
      });
    });

    it("deep merges env objects", () => {
      const user = { env: { MY_VAR: "foo", OTHER: "bar" } };
      const required = { env: { ANTHROPIC_BASE_URL: "https://api.poe.com" } };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        env: {
          MY_VAR: "foo",
          OTHER: "bar",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        }
      });
    });

    it("required env values override user env values", () => {
      const user = { env: { ANTHROPIC_BASE_URL: "https://custom.com" } };
      const required = { env: { ANTHROPIC_BASE_URL: "https://api.poe.com" } };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
      });
    });

    it("handles user with env and required without env", () => {
      const user = { env: { MY_VAR: "foo" } };
      const required = { apiKeyHelper: "echo $KEY" };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        env: { MY_VAR: "foo" },
        apiKeyHelper: "echo $KEY"
      });
    });

    it("handles user without env and required with env", () => {
      const user = { model: "opus" };
      const required = { env: { ANTHROPIC_BASE_URL: "https://api.poe.com" } };
      const result = mergeCliSettings(user, required);

      expect(result).toEqual({
        model: "opus",
        env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
      });
    });
  });

  describe("buildArgsWithMergedSettings", () => {
    it("adds --settings when not present in args", () => {
      const args = ["-p", "query"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      expect(result).toEqual(["-p", "query", "--settings", '{"apiKeyHelper":"echo $KEY"}']);
    });

    it("merges with existing --settings JSON", () => {
      const args = ["-p", "--settings", '{"model":"opus"}', "query"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      expect(result).toEqual([
        "-p",
        "query",
        "--settings",
        '{"model":"opus","apiKeyHelper":"echo $KEY"}'
      ]);
    });

    it("rejects file path --settings instead of dropping file values", () => {
      const args = ["-p", "--settings", "./settings.json", "query"];
      const required = { apiKeyHelper: "echo $KEY" };

      expect(() => buildArgsWithMergedSettings(args, required)).toThrow(
        "Cannot merge provider-required settings with --settings file path ./settings.json. Pass settings as inline JSON or remove --settings."
      );
    });

    it("preserves other args order", () => {
      const args = ["--model", "opus", "-p", "query", "--verbose"];
      const required = { apiKeyHelper: "echo $KEY" };
      const result = buildArgsWithMergedSettings(args, required);

      expect(result).toEqual([
        "--model",
        "opus",
        "-p",
        "query",
        "--verbose",
        "--settings",
        '{"apiKeyHelper":"echo $KEY"}'
      ]);
    });

    it("handles complex merge with env", () => {
      const args = ["--settings", '{"model":"opus","env":{"MY_VAR":"foo"}}', "-p", "query"];
      const required = {
        apiKeyHelper: "echo $POE_API_KEY",
        env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
      };
      const result = buildArgsWithMergedSettings(args, required);

      const parsed = JSON.parse(result[result.indexOf("--settings") + 1]);
      expect(parsed).toEqual({
        model: "opus",
        env: {
          MY_VAR: "foo",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        },
        apiKeyHelper: "echo $POE_API_KEY"
      });
    });
  });
});

// ── command-checks ────────────────────────────────────────────────────────────

function createRunner(
  responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>
) {
  return vi.fn(async (command: string, args: string[]) => {
    const key = [command, ...args].join(" ");
    const response = responses[key];
    if (!response) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode
    };
  });
}

describe("createBinaryExistsCheck", () => {
  it("passes after locating the binary", async () => {
    const runCommand = createRunner({
      "which demo": { stdout: "/usr/bin/demo\n", exitCode: 0 }
    });

    const check = createBinaryExistsCheck("demo", "demo-id", "demo desc");
    await check.run({ isDryRun: false, runCommand });

    expect(runCommand).toHaveBeenCalledWith("which", ["demo"]);
  });

  it("falls back through detection strategies", async () => {
    const runCommand = createRunner({
      "which demo": { stdout: "", exitCode: 1 },
      "where demo": { stdout: "/usr/bin/demo\n", exitCode: 0 }
    });

    const check = createBinaryExistsCheck("demo", "demo-id", "demo desc");
    await check.run({ isDryRun: false, runCommand });

    expect(runCommand).toHaveBeenCalledWith("which", ["demo"]);
    expect(runCommand).toHaveBeenCalledWith("where", ["demo"]);
  });

  it("does not accept an empty where result as present", async () => {
    const runCommand = createRunner({
      "which demo": { stdout: "", exitCode: 1 },
      "where demo": { stdout: "", exitCode: 0 },
      'sh -c for directory in /usr/local/bin /usr/bin "$HOME/.local/bin" "$HOME/.claude/local/bin"; do test -f "$directory/$1" && exit 0; done; exit 1 sh demo':
        {
          stdout: "",
          exitCode: 1
        }
    });

    const check = createBinaryExistsCheck("demo", "demo-id", "demo desc");

    await expect(check.run({ isDryRun: false, runCommand })).rejects.toThrow(
      "demo CLI binary not found on PATH."
    );
  });
});

describe("createSpawnHealthCheck", () => {
  it("runs an explicit CLI health invocation when provided", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "GEMINI_OK\n",
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("gemini-cli", {
      expectedOutput: "GEMINI_OK",
      invocation: { command: "gemini", args: ["-p", "say GEMINI_OK", "--sandbox=false"] }
    });
    await check.run({ isDryRun: false, runCommand });

    expect(runCommand).toHaveBeenCalledWith("gemini", ["-p", "say GEMINI_OK", "--sandbox=false"]);
  });

  it("runs the agent via runCommand with built spawn args", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"DEMO_OK"}\n',
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      model: "test-model",
      expectedOutput: "DEMO_OK"
    });
    await check.run({ isDryRun: false, runCommand });

    expect(runCommand).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "Output exactly: DEMO_OK", "--model", "test-model"])
    );
  });

  it("runs hook-enabled health checks through poe-code spawn", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: [
        'Dropped bridged hook event "PreToolUse" with handler type "http"',
        'Dropped bridged hook event "SessionEnd" with handler type "command"',
        "CODEX_OK"
      ].join("\n"),
      stderr: "",
      exitCode: 0
    });
    const logWarning = vi.fn();

    const check = createSpawnHealthCheck("codex", {
      model: "test-model",
      expectedOutput: "CODEX_OK",
      hooks: { from: "claude-code", strategy: "transform", scope: "project" }
    });
    await check.run({ isDryRun: false, runCommand, logWarning });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "spawn",
      "--hooks-from",
      "claude-code",
      "--hooks-strategy",
      "transform",
      "--hooks-scope",
      "project",
      "--model",
      "test-model",
      "--mode",
      "yolo",
      "codex",
      "Output exactly: CODEX_OK"
    ]);
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('handler type "http"'));
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('event "SessionEnd"'));
  });

  it("passes when expected output is found in stdout", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"DEMO_OK"}\n',
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await expect(check.run({ isDryRun: false, runCommand })).resolves.toBeUndefined();
  });

  it("throws when exit code is non-zero", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "error",
      exitCode: 1
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await expect(check.run({ isDryRun: false, runCommand })).rejects.toThrow(/exit code 1/);
  });

  it("throws when expected output not found in stdout", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"WRONG"}\n',
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await expect(check.run({ isDryRun: false, runCommand })).rejects.toThrow(/DEMO_OK/);
  });

  it("skips runCommand and logs dry run message when isDryRun is true", async () => {
    const runCommand = vi.fn();
    const logDryRun = vi.fn();

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await check.run({ isDryRun: true, runCommand, logDryRun });

    expect(runCommand).not.toHaveBeenCalled();
    expect(logDryRun).toHaveBeenCalledWith(expect.stringContaining("DEMO_OK"));
  });
});

describe("stdoutMatchesExpected", () => {
  it("matches plain text output", () => {
    expect(stdoutMatchesExpected("DEMO_OK\n", "DEMO_OK")).toBe(true);
  });

  it("matches when expected text is one of many plain lines", () => {
    expect(stdoutMatchesExpected("foo\nDEMO_OK\nbar\n", "DEMO_OK")).toBe(true);
  });

  it("rejects when no line matches", () => {
    expect(stdoutMatchesExpected("foo\nbar\n", "DEMO_OK")).toBe(false);
  });

  it("matches JSON streaming output with result event", () => {
    const stdout = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"DEMO_OK"}]}}',
      '{"type":"result","subtype":"success","result":"DEMO_OK"}'
    ].join("\n");
    expect(stdoutMatchesExpected(stdout, "DEMO_OK")).toBe(true);
  });

  it("rejects JSON streaming output when result does not match", () => {
    const stdout = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"result","subtype":"success","result":"WRONG"}'
    ].join("\n");
    expect(stdoutMatchesExpected(stdout, "DEMO_OK")).toBe(false);
  });
});

describe("createCommandExpectationCheck", () => {
  it("derives a description based on the command and expected output", () => {
    const check = createCommandExpectationCheck({
      id: "demo-health",
      command: "demo",
      args: ["run", 'Output exactly: "DEMO_OK"'],
      expectedOutput: "DEMO_OK"
    });

    expect(check.description).toBe(
      'demo run "Output exactly: \\"DEMO_OK\\"" (expecting "DEMO_OK")'
    );
  });

  it("passes command options through to the runner", async () => {
    const check = createCommandExpectationCheck({
      id: "demo-health",
      command: "demo",
      args: ["run"],
      expectedOutput: "DEMO_OK",
      commandOptions: { env: { DEMO_MODE: "test" } }
    });
    const runCommand = vi.fn(async () => ({
      stdout: "DEMO_OK\n",
      stderr: "",
      exitCode: 0
    }));

    await check.run({ isDryRun: false, runCommand });

    expect(runCommand).toHaveBeenCalledWith("demo", ["run"], {
      env: { DEMO_MODE: "test" }
    });
  });
});

// ── dry-run ───────────────────────────────────────────────────────────────────

describe("dry run diff redaction", () => {
  it("redacts api key values in JSON diffs", () => {
    const diff = renderUnifiedDiff(
      resolveConfigPath("/home/test"),
      null,
      '{\n  "apiKey": "sk-test"\n}\n'
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-test");
    expect(output).toContain("<redacted>");
  });

  it("redacts api key helper commands in JSON diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.claude/settings.json",
      null,
      '{\n  "apiKeyHelper": "echo sk-test"\n}\n'
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-test");
    expect(output).toContain("echo <redacted>");
  });

  it("redacts Anthropic API keys in Claude settings diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.claude/settings.json",
      null,
      '{\n  "env": {\n    "ANTHROPIC_API_KEY": "sk-test"\n  }\n}\n'
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-test");
    expect(output).toContain("<redacted>");
  });

  it("redacts Anthropic custom auth headers in Claude settings diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.claude/settings.json",
      null,
      '{\n  "env": {\n    "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer sk-test"\n  }\n}\n'
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-test");
    expect(output).toContain("<redacted>");
  });

  it("redacts auth keys and bearer tokens in auth diffs", () => {
    const authDiff = renderUnifiedDiff(
      "/home/test/.config/opencode/auth.json",
      null,
      '{\n  "type": "api",\n  "key": "sk-test"\n}\n'
    );
    const authOutput = authDiff.join("\n");
    expect(authOutput).not.toContain("sk-test");
    expect(authOutput).toContain('"key": "<redacted>"');

    const tomlDiff = renderUnifiedDiff(
      "/home/test/.codex/config.toml",
      null,
      'experimental_bearer_token = "sk-test"\n'
    );
    const tomlOutput = tomlDiff.join("\n");
    expect(tomlOutput).not.toContain("sk-test");
    expect(tomlOutput).toContain("<redacted>");
  });
});

describe("formatDryRunOperations symlink and rename", () => {
  it("formats symlink as ln -s", () => {
    const lines = formatDryRunOperations([
      { type: "symlink", target: "AGENTS.md", path: "CLAUDE.md" }
    ]);
    expect(lines.join("\n")).toContain("ln -s AGENTS.md CLAUDE.md");
  });

  it("formats rename as mv", () => {
    const lines = formatDryRunOperations([{ type: "rename", from: "CLAUDE.md", to: "AGENTS.md" }]);
    expect(lines.join("\n")).toContain("mv CLAUDE.md AGENTS.md");
  });
});

describe("createDryRunFileSystem symlink and rename", () => {
  function makeBase(): FileSystem {
    return {
      readFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
      writeFile: vi.fn().mockResolvedValue(undefined),
      symlink: vi.fn().mockResolvedValue(undefined),
      readlink: vi.fn().mockResolvedValue("/target"),
      mkdir: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({} as any),
      lstat: vi.fn().mockResolvedValue({} as any),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([])
    } as unknown as FileSystem;
  }

  it("records symlink without calling base.symlink", async () => {
    const base = makeBase();
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.symlink("AGENTS.md", "CLAUDE.md");

    const ops = recorder.drain();
    expect(ops).toEqual([{ type: "symlink", target: "AGENTS.md", path: "CLAUDE.md" }]);
    expect(base.symlink).not.toHaveBeenCalled();
  });

  it("records rename without calling base.rename", async () => {
    const base = makeBase();
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.rename("CLAUDE.md", "AGENTS.md");

    const ops = recorder.drain();
    expect(ops).toEqual([{ type: "rename", from: "CLAUDE.md", to: "AGENTS.md" }]);
    expect(base.rename).not.toHaveBeenCalled();
  });

  it("delegates readlink to base", async () => {
    const base = makeBase();
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    const result = await dryFs.readlink("CLAUDE.md");

    expect(result).toBe("/target");
    expect(base.readlink).toHaveBeenCalledWith("CLAUDE.md");
    expect(recorder.drain()).toEqual([]);
  });

  it("delegates lstat to base", async () => {
    const base = makeBase();
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.lstat("CLAUDE.md");

    expect(base.lstat).toHaveBeenCalledWith("CLAUDE.md");
    expect(recorder.drain()).toEqual([]);
  });
});

// ── execution-context ─────────────────────────────────────────────────────────

describe("detectExecutionContext", () => {
  const baseEnv: Record<string, string | undefined> = {};
  const moduleUrl = "file:///workspace/poe-code/src/index.ts";

  describe("development mode detection", () => {
    it("detects tsx execution via .ts extension in argv", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/workspace/poe-code/src/index.ts", "mcp"],
        env: baseEnv,
        moduleUrl
      });

      expect(result.mode).toBe("development");
      expect(result.command.command).toBe("npm");
      expect(result.command.args).toEqual([
        "--silent",
        "--prefix",
        "/workspace/poe-code",
        "run",
        "dev",
        "--"
      ]);
    });

    it("detects npm run dev via lifecycle event", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/workspace/poe-code/dist/index.js", "mcp"],
        env: { npm_lifecycle_event: "dev" },
        moduleUrl
      });

      expect(result.mode).toBe("development");
    });

    it("detects tsx loader via NODE_OPTIONS", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/workspace/poe-code/dist/index.js", "mcp"],
        env: { NODE_OPTIONS: "--import tsx/esm" },
        moduleUrl
      });

      expect(result.mode).toBe("development");
    });
  });

  describe("npx execution detection", () => {
    it("detects basic npx execution", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/home/user/.npm/_npx/12345/node_modules/.bin/poe-code", "mcp"],
        env: {
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npx-cli.js"
        },
        moduleUrl
      });

      expect(result.mode).toBe("npx");
      expect(result.command.command).toBe("npx");
      expect(result.command.args).toEqual(["--yes", "poe-code"]);
    });

    it("detects npx@beta execution", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/home/user/.npm/_npx/12345/node_modules/.bin/poe-code", "mcp"],
        env: {
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npx-cli.js",
          npm_package_version: "1.0.0-beta.1"
        },
        moduleUrl
      });

      expect(result.mode).toBe("npx-beta");
      expect(result.command.args).toEqual(["--yes", "poe-code@beta"]);
    });

    it("detects npx@latest execution", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/home/user/.npm/_npx/12345/node_modules/.bin/poe-code", "mcp"],
        env: {
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npx-cli.js",
          npm_package_json: "/home/user/.npm/_npx/poe-code@latest/package.json"
        },
        moduleUrl
      });

      expect(result.mode).toBe("npx-latest");
      expect(result.command.args).toEqual(["--yes", "poe-code@latest"]);
    });
  });

  describe("global installation detection", () => {
    it("uses poe when invoked as poe", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/usr/local/bin/poe"],
        env: {},
        moduleUrl
      });

      expect(result.mode).toBe("global");
      expect(result.command.command).toBe("poe");
      expect(result.command.args).toEqual([]);
    });

    it("uses poe-code when invoked as poe-code", () => {
      const result = detectExecutionContext({
        argv: ["/usr/bin/node", "/usr/lib/node_modules/poe-code/dist/index.js", "mcp"],
        env: {},
        moduleUrl
      });

      expect(result.mode).toBe("global");
      expect(result.command.command).toBe("poe-code");
      expect(result.command.args).toEqual([]);
    });
  });
});

describe("toMcpServerCommand", () => {
  it("appends subcommand to args", () => {
    const result = toMcpServerCommand({ command: "npx", args: ["--yes", "poe-code"] }, "mcp");

    expect(result).toEqual({
      command: "npx",
      args: ["--yes", "poe-code", "mcp"]
    });
  });

  it("works with global command", () => {
    const result = toMcpServerCommand({ command: "poe", args: [] }, "mcp");

    expect(result).toEqual({
      command: "poe",
      args: ["mcp"]
    });
  });
});

describe("toOpenCodeMcpCommand", () => {
  it("returns command as array for opencode format", () => {
    const result = toOpenCodeMcpCommand({ command: "npx", args: ["-y", "poe-code"] }, "mcp");

    expect(result).toEqual(["npx", "-y", "poe-code", "mcp"]);
  });

  it("works with npm run dev for development", () => {
    const result = toOpenCodeMcpCommand(
      { command: "npm", args: ["--silent", "--prefix", "/workspace/poe-code", "run", "dev", "--"] },
      "mcp"
    );

    expect(result).toEqual([
      "npm",
      "--silent",
      "--prefix",
      "/workspace/poe-code",
      "run",
      "dev",
      "--",
      "mcp"
    ]);
  });
});

describe("formatCliHelpCommand", () => {
  it("formats global help command as poe invocation", () => {
    const help = formatCliHelpCommand({ mode: "global", command: { command: "poe", args: [] } }, [
      "--help"
    ]);
    expect(help).toBe("poe --help");
  });

  it("formats npx help command with package spec", () => {
    const help = formatCliHelpCommand(
      { mode: "npx-beta", command: { command: "npx", args: ["--yes", "poe-code@beta"] } },
      ["mcp", "--help"]
    );
    expect(help).toBe("npx poe-code@beta mcp --help");
  });

  it("formats development help command as npm run dev", () => {
    const help = formatCliHelpCommand(
      { mode: "development", command: { command: "npm", args: [] } },
      ["--help"]
    );
    expect(help).toBe("npm run dev -- --help");
  });
});

describe("formatCliUsageCommand", () => {
  it("formats global usage as poe", () => {
    expect(formatCliUsageCommand({ mode: "global", command: { command: "poe", args: [] } })).toBe(
      "poe"
    );
  });

  it("formats global usage as poe-code when invoked as poe-code", () => {
    expect(
      formatCliUsageCommand({ mode: "global", command: { command: "poe-code", args: [] } })
    ).toBe("poe-code");
  });

  it("formats development usage as npm run dev", () => {
    expect(
      formatCliUsageCommand({ mode: "development", command: { command: "npm", args: [] } })
    ).toBe("npm run dev --");
  });

  it("formats npx-beta usage with channel", () => {
    expect(
      formatCliUsageCommand({
        mode: "npx-beta",
        command: { command: "npx", args: ["--yes", "poe-code@beta"] }
      })
    ).toBe("npx poe-code@beta");
  });
});
