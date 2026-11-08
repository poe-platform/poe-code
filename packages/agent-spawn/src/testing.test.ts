import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "./testing.js";

const defaultSpawnResult = {
  exitCode: 0,
  durationMs: 0,
  stdout: "",
  stderr: ""
};

const defaultAutonomousResult = {
  summary: "",
  log: "",
  output: "",
  stdout: "",
  text: "",
  toolCalls: [],
  sessionResult: {
    toolCalls: []
  }
};

describe("createSpawnMock()", () => {
  afterEach(() => {
    vi.doUnmock("@poe-code/agent-spawn");
    vi.resetModules();
  });

  it("returns factory, spawn, and autonomous mocks", () => {
    const spawnMock = createSpawnMock();

    expect(typeof spawnMock.factory).toBe("function");
    expect(typeof spawnMock.spawn).toBe("function");
    expect(typeof spawnMock.autonomous).toBe("function");
  });

  it("defaults spawn to a safe result", async () => {
    const spawnMock = createSpawnMock();

    await expect(spawnMock.spawn("codex", { prompt: "test" })).resolves.toEqual(
      defaultSpawnResult
    );
  });

  it("merges configured default overrides for spawn and autonomous", async () => {
    const spawnMock = createSpawnMock({
      spawnResult: {
        stdout: "spawn stdout"
      },
      autonomousResult: {
        summary: "autonomous summary"
      }
    });

    await expect(spawnMock.spawn("codex", { prompt: "test" })).resolves.toEqual({
      ...defaultSpawnResult,
      stdout: "spawn stdout"
    });
    await expect(spawnMock.autonomous("codex", { prompt: "test" })).resolves.toEqual({
      ...defaultAutonomousResult,
      summary: "autonomous summary"
    });
  });

  it("allows per-test spawn overrides with mockResolvedValueOnce", async () => {
    const spawnMock = createSpawnMock();

    spawnMock.spawn.mockResolvedValueOnce({
      exitCode: 7,
      durationMs: 123,
      stdout: "custom stdout",
      stderr: "custom stderr"
    });

    await expect(spawnMock.spawn("codex", { prompt: "custom" })).resolves.toEqual({
      exitCode: 7,
      durationMs: 123,
      stdout: "custom stdout",
      stderr: "custom stderr"
    });
    await expect(spawnMock.spawn("codex", { prompt: "default" })).resolves.toEqual(
      defaultSpawnResult
    );
  });

  it("returns a module shape accepted by vi.mock", async () => {
    vi.resetModules();
    const spawnMock = createSpawnMock();

    vi.doMock("@poe-code/agent-spawn", () => spawnMock.factory());

    const agentSpawn = await import("@poe-code/agent-spawn");

    expect(agentSpawn.spawn).toBe(spawnMock.spawn);
    expect((agentSpawn.spawn as typeof agentSpawn.spawn & { autonomous?: unknown }).autonomous).toBe(
      spawnMock.autonomous
    );
    await expect(agentSpawn.spawn("codex", { prompt: "test" })).resolves.toEqual(
      defaultSpawnResult
    );
  });

  it("keeps autonomous independent from spawn", async () => {
    const spawnMock = createSpawnMock();

    spawnMock.spawn.mockResolvedValueOnce({
      exitCode: 3,
      durationMs: 22,
      stdout: "spawn override",
      stderr: ""
    });
    spawnMock.autonomous.mockResolvedValueOnce({
      summary: "autonomous override",
      log: "",
      output: "",
      stdout: "",
      text: "",
      toolCalls: [],
      sessionResult: {
        toolCalls: []
      }
    });

    await expect(spawnMock.spawn("codex", { prompt: "spawn" })).resolves.toEqual({
      exitCode: 3,
      durationMs: 22,
      stdout: "spawn override",
      stderr: ""
    });
    await expect(spawnMock.autonomous("codex", { prompt: "autonomous" })).resolves.toEqual({
      summary: "autonomous override",
      log: "",
      output: "",
      stdout: "",
      text: "",
      toolCalls: [],
      sessionResult: {
        toolCalls: []
      }
    });
    await expect(spawnMock.spawn("codex", { prompt: "spawn default" })).resolves.toEqual(
      defaultSpawnResult
    );
    await expect(
      spawnMock.autonomous("codex", { prompt: "autonomous default" })
    ).resolves.toEqual(defaultAutonomousResult);
  });
});
