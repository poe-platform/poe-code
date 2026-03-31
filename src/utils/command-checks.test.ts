import { describe, it, expect, vi } from "bun:test";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck,
  createSpawnHealthCheck,
  stdoutMatchesExpected
} from "./command-checks.js";

function createRunner(responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>) {
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
});

describe("createSpawnHealthCheck", () => {
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
        "-p", "Output exactly: DEMO_OK",
        "--model", "test-model"
      ])
    );
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
    await expect(
      check.run({ isDryRun: false, runCommand })
    ).resolves.toBeUndefined();
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
    await expect(
      check.run({ isDryRun: false, runCommand })
    ).rejects.toThrow(/exit code 1/);
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
    await expect(
      check.run({ isDryRun: false, runCommand })
    ).rejects.toThrow(/DEMO_OK/);
  });

  it("skips runCommand and logs dry run message when isDryRun is true", async () => {
    const runCommand = vi.fn();
    const logDryRun = vi.fn();

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await check.run({ isDryRun: true, runCommand, logDryRun });

    expect(runCommand).not.toHaveBeenCalled();
    expect(logDryRun).toHaveBeenCalledWith(
      expect.stringContaining("DEMO_OK")
    );
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
});
