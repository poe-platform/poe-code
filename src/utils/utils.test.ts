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
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
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
      expect.arrayContaining([
        "-p",
        "Output exactly: DEMO_OK",
        "--model",
        "test-model",
        "--permission-mode",
        "plan"
      ])
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
      hooks: { from: "claude-code", strategy: "transform", scope: "project" },
      host: { command: "poe-code", args: [] }
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
      "read",
      "codex",
      "Output exactly: CODEX_OK"
    ]);
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('handler type "http"'));
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('event "SessionEnd"'));
  });

  it("runs hook-enabled health checks through the resolved host command", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "CODEX_OK",
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("codex", {
      expectedOutput: "CODEX_OK",
      hooks: { from: "claude-code" },
      host: { command: "npm", args: ["--silent", "--prefix", "/repo", "run", "dev", "--"] }
    });
    await check.run({ isDryRun: false, runCommand });

    expect(runCommand).toHaveBeenCalledWith("npm", [
      "--silent",
      "--prefix",
      "/repo",
      "run",
      "dev",
      "--",
      "spawn",
      "--hooks-from",
      "claude-code",
      "--mode",
      "read",
      "codex",
      "Output exactly: CODEX_OK"
    ]);
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

describe("spawn health check failure reporting", () => {
  const jsonlFlood = [
    '{"type":"system","subtype":"init","session_id":"abc","tools":["Bash","Read"]}',
    '{"type":"assistant","message":{"id":"msg_1","content":[{"type":"text","text":"working"}]}}',
    '{"type":"result","subtype":"error","result":"Invalid API key - please run /login"}'
  ].join("\n");

  async function captureError(
    context: Parameters<ReturnType<typeof createSpawnHealthCheck>["run"]>[0]
  ): Promise<Error> {
    const check = createSpawnHealthCheck("claude-code", { expectedOutput: "DEMO_OK" });
    const error = await check.run(context).then(
      () => undefined,
      (thrown: Error) => thrown
    );
    if (!error) {
      throw new Error("expected the health check to fail");
    }
    return error;
  }

  it("summarises a non-zero exit with the cause instead of the raw agent stream", async () => {
    const error = await captureError({
      isDryRun: false,
      runCommand: vi.fn().mockResolvedValue({ stdout: jsonlFlood, stderr: "", exitCode: 1 })
    });

    expect(error.message).toContain("exit code 1");
    expect(error.message).toContain("Invalid API key - please run /login");
    expect(error.message).not.toContain('"type":"system"');
    expect(error.message).not.toContain('"type":"assistant"');
    expect(error.message).toContain("--verbose");
  });

  it("prefers stderr as the cause when the agent writes one", async () => {
    const error = await captureError({
      isDryRun: false,
      runCommand: vi.fn().mockResolvedValue({
        stdout: jsonlFlood,
        stderr: "claude: command not found",
        exitCode: 127
      })
    });

    expect(error.message).toContain("claude: command not found");
    expect(error.message).not.toContain('"type":"system"');
  });

  it("summarises unexpected output without dumping the raw agent stream", async () => {
    const error = await captureError({
      isDryRun: false,
      runCommand: vi.fn().mockResolvedValue({ stdout: jsonlFlood, stderr: "", exitCode: 0 })
    });

    expect(error.message).toContain('expected "DEMO_OK"');
    expect(error.message).toContain("Invalid API key - please run /login");
    expect(error.message).not.toContain('"type":"system"');
    expect(error.message).toContain("--verbose");
  });

  it("includes the raw agent stream when the check context is verbose", async () => {
    const error = await captureError({
      isDryRun: false,
      verbose: true,
      runCommand: vi.fn().mockResolvedValue({ stdout: jsonlFlood, stderr: "", exitCode: 1 })
    });

    expect(error.message).toContain("stdout:");
    expect(error.message).toContain('"type":"system"');
    expect(error.message).toContain('"type":"assistant"');
    expect(error.message).not.toContain("--verbose");
  });

  it("summarises expectation check failures and keeps the stream behind verbose", async () => {
    const options = {
      id: "demo-health",
      command: "demo",
      args: ["run"],
      expectedOutput: "DEMO_OK"
    };
    const runCommand = vi.fn().mockResolvedValue({
      stdout: jsonlFlood,
      stderr: "",
      exitCode: 1
    });

    const summarised = await createCommandExpectationCheck(options)
      .run({ isDryRun: false, runCommand })
      .then(
        () => undefined,
        (thrown: Error) => thrown
      );
    expect(summarised?.message).toContain("Invalid API key - please run /login");
    expect(summarised?.message).not.toContain('"type":"system"');

    const verbose = await createCommandExpectationCheck(options)
      .run({ isDryRun: false, runCommand, verbose: true })
      .then(
        () => undefined,
        (thrown: Error) => thrown
      );
    expect(verbose?.message).toContain('"type":"system"');
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

  it("redacts api key values in goose secrets.yaml diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/goose/secrets.yaml",
      null,
      "CUSTOM_POE_API_KEY: sk-poe-livesecret\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-poe-livesecret");
    expect(output).toContain("CUSTOM_POE_API_KEY: <redacted>");
  });

  it("redacts api key values removed from goose secrets.yaml on unconfigure", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/goose/secrets.yaml",
      "CUSTOM_POE_API_KEY: sk-poe-livesecret\nOTHER: keep\n",
      "OTHER: keep\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-poe-livesecret");
    expect(output).toContain("<redacted>");
  });

  it("redacts quoted api key values in yaml diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/goose/secrets.yaml",
      null,
      'CUSTOM_POE_API_KEY: "cfut_livesecret"\n'
    );
    const output = diff.join("\n");
    expect(output).not.toContain("cfut_livesecret");
    expect(output).toContain("<redacted>");
  });

  it("redacts api key values in env file diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/agent/.env",
      null,
      "CUSTOM_POE_API_KEY=sk-poe-livesecret\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-poe-livesecret");
    expect(output).toContain("<redacted>");
  });

  it("redacts bearer token values in ini diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/agent/config.ini",
      null,
      "[auth]\nexperimental_bearer_token = cfut_livesecret\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("cfut_livesecret");
    expect(output).toContain("<redacted>");
  });

  it("redacts poe and cloudflare token values under unknown key names in any format", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/agent/settings.conf",
      null,
      "some_new_credential: sk-poe-livesecret\nanother_token = cfut_livesecret\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-poe-livesecret");
    expect(output).not.toContain("cfut_livesecret");
    expect(output).toContain("<redacted>");
  });

  it("leaves non-secret yaml values intact", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.config/goose/config.yaml",
      null,
      "GOOSE_PROVIDER: custom_poe\nGOOSE_MODEL: Claude-Sonnet-4.5\n"
    );
    const output = diff.join("\n");
    expect(output).toContain("GOOSE_PROVIDER: custom_poe");
    expect(output).toContain("GOOSE_MODEL: Claude-Sonnet-4.5");
    expect(output).not.toContain("<redacted>");
  });
});

describe("formatDryRunOperations directory previews", () => {
  it("marks a directory that already exists as no change", async () => {
    const base = createMockFs({ "/home/test/.gemini/settings.json": "{}\n" }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.mkdir("/home/test/.gemini", { recursive: true });

    const output = formatDryRunOperations(recorder.drain()).join("\n");
    expect(output).toContain("# exists");
    expect(output).not.toContain("# ensure");
  });

  it("marks a missing directory as a pending create", async () => {
    const base = createMockFs({}) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.mkdir("/home/test/.gemini", { recursive: true });

    const output = formatDryRunOperations(recorder.drain()).join("\n");
    expect(output).toContain("mkdir -p /home/test/.gemini");
    expect(output).toContain("# ensure");
    expect(output).not.toContain("# exists");
  });
});

describe("formatDryRunOperations symlink and rename", () => {
  it("quotes path-like command arguments", () => {
    const lines = formatDryRunOperations([
      { type: "mkdir", path: "/tmp/project dir", options: { recursive: true } },
      {
        type: "writeFile",
        path: "/tmp/project dir/config.json",
        previousContent: null,
        nextContent: '{"ok":true}\n'
      },
      { type: "symlink", target: "source file.md", path: "linked file.md" },
      {
        type: "rm",
        path: "/tmp/project dir/old file",
        options: { recursive: true, force: true }
      },
      { type: "copyFile", from: "source file.md", to: "target file.md" },
      { type: "chmod", path: "script file.sh", mode: 0o755 },
      { type: "rename", from: "old name.md", to: "new name.md" }
    ]);
    const output = lines.join("\n");

    expect(output).toContain("mkdir -p '/tmp/project dir'");
    expect(output).toContain("cat > '/tmp/project dir/config.json'");
    expect(output).toContain("ln -s 'source file.md' 'linked file.md'");
    expect(output).toContain("rm -r -f '/tmp/project dir/old file'");
    expect(output).toContain("cp 'source file.md' 'target file.md'");
    expect(output).toContain("chmod 755 'script file.sh'");
    expect(output).toContain("mv 'old name.md' 'new name.md'");
  });

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

describe("createDryRunFileSystem atomic writes", () => {
  // Colour codes land between the diff marker and the text, so assertions on
  // "+line" need the styling removed first.
  const stripAnsi = (value: string): string => {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "\u001b" && value[index + 1] === "[") {
        const end = value.indexOf("m", index);
        if (end !== -1) {
          index = end;
          continue;
        }
      }
      result += value[index];
    }
    return result;
  };

  const targetPath = "/home/test/.claude/settings.json";
  const tempPath = `${targetPath}.mutation-tmp-123-abc`;
  const existing = '{\n  "effortLevel": "high",\n  "model": "old"\n}\n';
  const next = '{\n  "effortLevel": "high",\n  "model": "new"\n}\n';

  it("folds a temp write plus rename into an update of the real target", async () => {
    const base = createMockFs({ [targetPath]: existing }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.writeFile(tempPath, next, { encoding: "utf8" });
    await dryFs.rename(tempPath, targetPath);

    expect(recorder.drain()).toEqual([
      {
        type: "writeFile",
        path: targetPath,
        nextContent: next,
        previousContent: existing
      }
    ]);
  });

  it("previews only the delta against the existing file, not a create from /dev/null", async () => {
    const base = createMockFs({ [targetPath]: existing }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.writeFile(tempPath, next, { encoding: "utf8" });
    await dryFs.rename(tempPath, targetPath);

    const output = stripAnsi(formatDryRunOperations(recorder.drain()).join("\n"));

    expect(output).toContain(`cat > ${targetPath}`);
    expect(output).toContain("# update");
    expect(output).not.toContain("# create");
    expect(output).not.toContain("/dev/null");
    expect(output).not.toContain("mutation-tmp");
    // Pre-existing untouched values must not be reported as additions.
    expect(output).not.toContain('+  "effortLevel": "high"');
    expect(output).toContain('+  "model": "new"');
    expect(output).toContain('-  "model": "old"');
  });

  it("reports a create when the atomic write targets a new file", async () => {
    const base = createMockFs({}) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.writeFile(tempPath, next, { encoding: "utf8" });
    await dryFs.rename(tempPath, targetPath);

    const output = stripAnsi(formatDryRunOperations(recorder.drain()).join("\n"));

    expect(output).toContain(`cat > ${targetPath}`);
    expect(output).toContain("# create");
    expect(output).toContain("/dev/null");
    expect(output).not.toContain("mutation-tmp");
  });

  it("reports no change when the atomic write rewrites identical content", async () => {
    const base = createMockFs({ [targetPath]: existing }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.writeFile(tempPath, existing, { encoding: "utf8" });
    await dryFs.rename(tempPath, targetPath);

    const output = stripAnsi(formatDryRunOperations(recorder.drain()).join("\n"));

    expect(output).toContain("# no change");
    expect(output).not.toContain("mutation-tmp");
  });

  it("coalesces repeated writes to one file into the original-to-final delta", async () => {
    // Manifests commonly transform a file and then merge into it, so the same
    // target is written twice against the same on-disk baseline. The preview
    // must show the end state, not the intermediate one.
    const base = createMockFs({ [targetPath]: existing }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);
    const intermediate = '{\n  "effortLevel": "high"\n}\n';
    const final = '{\n  "effortLevel": "high",\n  "model": "final"\n}\n';

    await dryFs.writeFile(`${tempPath}-1`, intermediate, { encoding: "utf8" });
    await dryFs.rename(`${tempPath}-1`, targetPath);
    await dryFs.writeFile(`${tempPath}-2`, final, { encoding: "utf8" });
    await dryFs.rename(`${tempPath}-2`, targetPath);

    const lines = formatDryRunOperations(recorder.drain());
    const output = stripAnsi(lines.join("\n"));

    expect(lines).toHaveLength(1);
    expect(output).toContain("# update");
    // Baseline stays the real file and the content is the end state, so the
    // intermediate write is never presented as the outcome.
    expect(output).toContain('+  "model": "final"');
    expect(output).toContain('-  "model": "old"');
    expect(output).not.toContain('+  "effortLevel": "high"');
    expect(output).not.toContain("mutation-tmp");
  });

  it("drops a write pair that ends at the original content", async () => {
    const base = createMockFs({ [targetPath]: existing }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.writeFile(`${tempPath}-1`, next, { encoding: "utf8" });
    await dryFs.rename(`${tempPath}-1`, targetPath);
    await dryFs.writeFile(`${tempPath}-2`, existing, { encoding: "utf8" });
    await dryFs.rename(`${tempPath}-2`, targetPath);

    const output = stripAnsi(formatDryRunOperations(recorder.drain()).join("\n"));

    expect(output).toContain("# no change");
    expect(output).not.toContain('"model": "new"');
  });

  it("keeps an unrelated rename as a move", async () => {
    const base = createMockFs({ "/home/test/CLAUDE.md": "hi\n" }) as unknown as FileSystem;
    const recorder = new DryRunRecorder();
    const dryFs = createDryRunFileSystem(base, recorder);

    await dryFs.writeFile(tempPath, next, { encoding: "utf8" });
    await dryFs.rename("/home/test/CLAUDE.md", "/home/test/AGENTS.md");

    expect(recorder.drain()).toEqual([
      { type: "writeFile", path: tempPath, nextContent: next, previousContent: null },
      { type: "rename", from: "/home/test/CLAUDE.md", to: "/home/test/AGENTS.md" }
    ]);
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

  it("formats npx latest help command with package spec", () => {
    const help = formatCliHelpCommand(
      { mode: "npx-latest", command: { command: "npx", args: ["--yes", "poe-code@latest"] } },
      ["mcp", "--help"]
    );
    expect(help).toBe("npx poe-code@latest mcp --help");
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

  it("formats npx-latest usage with channel", () => {
    expect(
      formatCliUsageCommand({
        mode: "npx-latest",
        command: { command: "npx", args: ["--yes", "poe-code@latest"] }
      })
    ).toBe("npx poe-code@latest");
  });
});
