import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEntry, StateManager } from "@poe-code/poe-code-config";
import type { JobHandle, LogChunk } from "@poe-code/process-runner";
import { resolveJob, streamJobLog } from "./shared.js";
import { ValidationError } from "../../../errors.js";

function job(overrides: Partial<JobEntry> & Pick<JobEntry, "id" | "started_at">): JobEntry {
  return {
    env_id: `env-${overrides.id}`,
    env_kind: "docker",
    tool: "codex",
    argv: ["codex"],
    cwd: "/repo",
    status: "running",
    ...overrides
  };
}

function createState(entries: JobEntry[]): StateManager {
  return {
    jobs: {
      async list() {
        return entries;
      },
      async get(id: string) {
        return entries.find((entry) => entry.id === id) ?? null;
      }
    }
  } as unknown as StateManager;
}

describe("streamJobLog", () => {
  const next = vi.fn<() => Promise<IteratorResult<LogChunk>>>();
  const finish = vi.fn<() => Promise<IteratorResult<LogChunk>>>();
  const status = vi.fn<JobHandle["status"]>();
  const stream = vi.fn(() => ({
    [Symbol.asyncIterator]: () => ({ next, return: finish })
  }));
  const handle: JobHandle = {
    id: "job-logs",
    envId: "container-id",
    tool: "node",
    argv: ["node"],
    status,
    stream,
    wait: vi.fn(),
    kill: vi.fn()
  };

  beforeEach(() => {
    vi.useFakeTimers();
    next.mockReset().mockResolvedValue({ done: true, value: undefined });
    finish.mockReset().mockResolvedValue({ done: true, value: undefined });
    status.mockReset().mockResolvedValue("running");
    stream.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["exited", "killed", "lost"] as const)("drains all delayed chunks after terminal status %s", async (terminalStatus) => {
    status.mockResolvedValue(terminalStatus);
    next.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ done: false, value: { byteOffset: 0, data: "first\n" } }), 300);
    })).mockResolvedValueOnce({ done: false, value: { byteOffset: 6, data: "last\n" } });
    const write = vi.fn();
    const reading = streamJobLog(handle, { follow: true, write });

    await vi.advanceTimersByTimeAsync(300);
    await reading;

    expect(write.mock.calls).toEqual([["first\n"], ["last\n"]]);
    expect(stream).toHaveBeenCalledExactlyOnceWith({ sinceByte: 0, follow: true });
    expect(next).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a final chunk error after terminal status and closes the iterator", async () => {
    const failure = new Error("Final stream read failed");
    status.mockResolvedValue("exited");
    next.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ done: false, value: { byteOffset: 0, data: "first\n" } }), 300);
    })).mockRejectedValueOnce(failure);
    const write = vi.fn();
    const completion = streamJobLog(handle, { follow: true, write }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(300);
    expect(await completion).toBe(failure);

    expect(write.mock.calls).toEqual([["first\n"]]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("continues polling running jobs until their iterator completes", async () => {
    next.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ done: false, value: { byteOffset: 0, data: "output\n" } }), 600);
    }));
    const write = vi.fn();
    const reading = streamJobLog(handle, { follow: true, write });

    await vi.advanceTimersByTimeAsync(600);
    await reading;

    expect(write.mock.calls).toEqual([["output\n"]]);
    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("consumes a non-follow snapshot without polling status", async () => {
    const since = new Date("2026-08-26T00:00:00.000Z");
    next.mockResolvedValueOnce({ done: false, value: { byteOffset: 0, data: "first\n" } })
      .mockResolvedValueOnce({ done: false, value: { byteOffset: 6, data: "last\n" } });
    const write = vi.fn();

    await streamJobLog(handle, { follow: false, since, write });

    expect(write.mock.calls).toEqual([["first\n"], ["last\n"]]);
    expect(stream).toHaveBeenCalledExactlyOnceWith({ since, follow: false });
    expect(next).toHaveBeenCalledTimes(3);
    expect(status).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("resolveJob", () => {
  it("defaults to the unambiguously most recent candidate instead of erroring", async () => {
    const state = createState([
      job({ id: "old", started_at: "2026-06-16T10:00:00.000Z" }),
      job({ id: "newest", started_at: "2026-07-08T10:00:00.000Z" }),
      job({ id: "middle", started_at: "2026-06-25T10:00:00.000Z" })
    ]);

    await expect(resolveJob(state, undefined, "running")).resolves.toMatchObject({ id: "newest" });
  });

  it("caps the candidate list and reports a user error when the newest match is ambiguous", async () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      job({ id: `job-${index}`, started_at: "2026-07-08T10:00:00.000Z" })
    );
    const state = createState(entries);

    const error = await resolveJob(state, undefined, "pullable").catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ValidationError);
    const message = (error as Error).message;
    expect(message.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
    expect(message).toContain("3 more");
  });
});
