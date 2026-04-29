import * as fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { createSnapshotScheduler } = await import("./scheduler.js");

describe("snapshot scheduler", () => {
  beforeEach(() => {
    vol.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing when snapshotPath is omitted", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const scheduler = createSnapshotScheduler<{ step: string }>({});

    vi.advanceTimersByTime(30_000);
    scheduler.onYield(() => ({
      step: "ignored"
    }));
    await scheduler.finish();

    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it("writes atomically at the next yield once the default interval has elapsed", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/state.json"
    });

    scheduler.onYield(() => ({
      step: "too-early"
    }));
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);

    vi.advanceTimersByTime(29_999);
    scheduler.onYield(() => ({
      step: "still-too-early"
    }));
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);

    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "checkpointed"
    }));
    await scheduler.finish();

    expect(writeFileSpy).toHaveBeenCalledWith(
      "/state.json.tmp",
      JSON.stringify(
        {
          step: "checkpointed"
        },
        null,
        2
      )
    );
    expect(renameSpy).toHaveBeenCalledWith("/state.json.tmp", "/state.json");
    expect(vol.existsSync("/state.json.tmp")).toBe(false);
    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      step: "checkpointed"
    });
  });

  it("respects a custom interval and waits for the next full period after each checkpoint", async () => {
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotIntervalMs: 5_000,
      snapshotPath: "/state.json"
    });

    vi.advanceTimersByTime(5_000);
    scheduler.onYield(() => ({
      step: "first"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      step: "first"
    });

    scheduler.onYield(() => ({
      step: "too-soon"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      step: "first"
    });

    vi.advanceTimersByTime(4_999);
    scheduler.onYield(() => ({
      step: "still-too-soon"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      step: "first"
    });

    vi.advanceTimersByTime(1);
    scheduler.onYield(() => ({
      step: "second"
    }));
    await scheduler.finish();

    expect(JSON.parse(vol.readFileSync("/state.json", "utf8") as string)).toEqual({
      step: "second"
    });
  });

  it("does not checkpoint on finish when no yield happens after the interval elapses", async () => {
    const scheduler = createSnapshotScheduler<{ step: string }>({
      snapshotPath: "/state.json"
    });

    scheduler.onYield(() => ({
      step: "initial"
    }));
    vi.advanceTimersByTime(30_000);
    await scheduler.finish();

    expect(vol.existsSync("/state.json")).toBe(false);
  });
});
