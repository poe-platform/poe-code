import { describe, it, expect, vi } from "vitest";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck,
  createSpawnHealthCheck
} from "./command-checks.js";
import { spawn } from "@poe-code/agent-spawn";

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return { ...actual, spawn: vi.fn() };
});

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
  it("calls spawn with the agent id and expected output prompt", async () => {
    const spawnMock = vi.mocked(spawn).mockResolvedValue({
      stdout: '{"type":"text","text":"DEMO_OK"}\n',
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      model: "test-model",
      expectedOutput: "DEMO_OK"
    });
    await check.run({ isDryRun: false, runCommand: vi.fn() });

    expect(spawnMock).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: "Output exactly: DEMO_OK",
        model: "test-model",
        mode: "yolo"
      }),
      undefined
    );
  });

  it("passes when expected output is found in stdout", async () => {
    vi.mocked(spawn).mockResolvedValue({
      stdout: '{"type":"text","text":"DEMO_OK"}\n',
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await expect(
      check.run({ isDryRun: false, runCommand: vi.fn() })
    ).resolves.toBeUndefined();
  });

  it("throws when exit code is non-zero", async () => {
    vi.mocked(spawn).mockResolvedValue({
      stdout: "",
      stderr: "error",
      exitCode: 1
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await expect(
      check.run({ isDryRun: false, runCommand: vi.fn() })
    ).rejects.toThrow(/exit code 1/);
  });

  it("throws when expected output not found in stdout", async () => {
    vi.mocked(spawn).mockResolvedValue({
      stdout: '{"type":"text","text":"WRONG"}\n',
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await expect(
      check.run({ isDryRun: false, runCommand: vi.fn() })
    ).rejects.toThrow(/DEMO_OK/);
  });

  it("uses spawn dryRun context when isDryRun is true", async () => {
    const spawnMock = vi.mocked(spawn).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    const check = createSpawnHealthCheck("claude-code", {
      expectedOutput: "DEMO_OK"
    });
    await check.run({ isDryRun: true, runCommand: vi.fn() });

    expect(spawnMock).toHaveBeenCalledWith(
      "claude-code",
      expect.anything(),
      expect.objectContaining({ dryRun: true })
    );
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
