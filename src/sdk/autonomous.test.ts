import { beforeEach, describe, expect, it, vi } from "vitest";

const renderAcpStreamMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    renderAcpStream: renderAcpStreamMock
  };
});

import { isActivityTimeoutError } from "@poe-code/agent-spawn";
import { spawnAutonomous } from "./autonomous.js";
import type { SpawnResult } from "./types.js";

function createEvents(): AsyncIterable<never> {
  return (async function* () {})();
}

function createSpawnResult(result: Promise<SpawnResult>) {
  return {
    events: createEvents(),
    result
  };
}

function createActivityTimeoutError(timeoutMs = 1_500): Error {
  const error = new Error(`Agent spawn timed out after ${timeoutMs / 1000}s of inactivity`);
  error.name = "ActivityTimeoutError";
  expect(isActivityTimeoutError(error)).toBe(true);
  return error;
}

describe("spawnAutonomous()", () => {
  beforeEach(() => {
    renderAcpStreamMock.mockReset();
    renderAcpStreamMock.mockResolvedValue(undefined);
  });

  it("returns the spawn result on the first attempt", async () => {
    const expected: SpawnResult = {
      stdout: "done",
      stderr: "",
      exitCode: 0
    };
    const sdkSpawn = vi.fn((_service: string, _options: object) =>
      createSpawnResult(Promise.resolve(expected))
    );

    const result = await spawnAutonomous(sdkSpawn, {
      service: "codex",
      prompt: "Fix the bug"
    });

    expect(sdkSpawn).toHaveBeenCalledTimes(1);
    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Fix the bug",
      activityTimeoutMs: 10 * 60 * 1000
    });
    expect(renderAcpStreamMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expected);
  });

  it("retries timeout errors and returns the first successful retry result", async () => {
    const timeoutError = createActivityTimeoutError();
    const expected: SpawnResult = {
      stdout: "retry-success",
      stderr: "",
      exitCode: 0
    };
    const sdkSpawn = vi
      .fn()
      .mockReturnValueOnce(createSpawnResult(Promise.reject(timeoutError)))
      .mockReturnValueOnce(createSpawnResult(Promise.resolve(expected)));

    const result = await spawnAutonomous(sdkSpawn, {
      service: "codex",
      prompt: "Retry me"
    });

    expect(sdkSpawn).toHaveBeenCalledTimes(2);
    expect(renderAcpStreamMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expected);
  });

  it("throws after exhausting timeout retries", async () => {
    const timeoutError = createActivityTimeoutError();
    const sdkSpawn = vi
      .fn()
      .mockReturnValue(createSpawnResult(Promise.reject(timeoutError)));

    await expect(
      spawnAutonomous(sdkSpawn, {
        service: "codex",
        prompt: "Still timing out"
      })
    ).rejects.toBe(timeoutError);

    expect(sdkSpawn).toHaveBeenCalledTimes(3);
    expect(renderAcpStreamMock).toHaveBeenCalledTimes(3);
  });

  it("throws non-timeout errors without retrying", async () => {
    const spawnError = new Error("spawn failed");
    const sdkSpawn = vi
      .fn()
      .mockReturnValue(createSpawnResult(Promise.reject(spawnError)));

    await expect(
      spawnAutonomous(sdkSpawn, {
        service: "codex",
        prompt: "Do not retry"
      })
    ).rejects.toBe(spawnError);

    expect(isActivityTimeoutError(spawnError)).toBe(false);
    expect(sdkSpawn).toHaveBeenCalledTimes(1);
    expect(renderAcpStreamMock).toHaveBeenCalledTimes(1);
  });

  it("passes through a custom activity timeout", async () => {
    const sdkSpawn = vi.fn((_service: string, _options: object) =>
      createSpawnResult(
        Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        })
      )
    );

    await spawnAutonomous(sdkSpawn, {
      service: "codex",
      prompt: "Custom timeout",
      activityTimeoutMs: 1_500
    });

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Custom timeout",
      activityTimeoutMs: 1_500
    });
  });

  it("uses a custom maxTimeoutRetries value", async () => {
    const timeoutError = createActivityTimeoutError();
    const sdkSpawn = vi
      .fn()
      .mockReturnValue(createSpawnResult(Promise.reject(timeoutError)));

    await expect(
      spawnAutonomous(sdkSpawn, {
        service: "codex",
        prompt: "Retry exactly twice",
        maxTimeoutRetries: 2
      })
    ).rejects.toBe(timeoutError);

    expect(sdkSpawn).toHaveBeenCalledTimes(2);
    expect(renderAcpStreamMock).toHaveBeenCalledTimes(2);
  });
});
