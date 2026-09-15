import { describe, expect, it } from "vitest";
import { createRenderPerformanceMonitor, formatRenderPerformance } from "./render-performance.js";

describe("render performance", () => {
  it("measures dispatched frames, input latency and coalesced updates", () => {
    let now = 0;
    const monitor = createRenderPerformanceMonitor({ now: () => now });
    monitor.request("input");
    now = 3;
    monitor.request("update");
    monitor.request("update");
    now = 16;
    const started = monitor.begin();
    now = 20;
    monitor.end(started, { changedCells: 4 });
    expect(monitor.snapshot()).toMatchObject({ frames: 1, fps: 1, requests: 3, coalesced: 2,
      renderMs: { p50: 4, p95: 4, max: 4 }, inputMs: { p50: 20, p95: 20, max: 20 } });
    now = 1021;
    expect(monitor.snapshot().fps).toBe(0);
  });

  it("separates empty renders from terminal repaint dispatch", () => {
    const monitor = createRenderPerformanceMonitor({ now: () => 1 });
    monitor.request("update");
    monitor.end(monitor.begin(), { changedCells: 0 });
    expect(monitor.snapshot()).toMatchObject({ frames: 0, renders: 1, fps: 0 });
  });

  it("bounds samples and computes nearest-rank percentiles", () => {
    let now = 0;
    const monitor = createRenderPerformanceMonitor({ now: () => now, sampleSize: 4 });
    for (const duration of [100, 1, 2, 3, 4]) {
      const started = monitor.begin(); now += duration;
      monitor.end(started, { changedCells: 1 });
    }
    expect(monitor.snapshot()).toMatchObject({ frames: 5, sampleCount: 4, renderMs: { p50: 2, p95: 4, max: 4 } });
  });

  it("fits diagnostics to narrow terminal cells", () => {
    const monitor = createRenderPerformanceMonitor();
    expect(formatRenderPerformance(monitor.snapshot(), 12).length).toBeLessThanOrEqual(12);
    expect(formatRenderPerformance(monitor.snapshot(), 100)).toContain("FPS");
  });

  it("rejects unbounded or empty sampling configurations", () => {
    for (const sampleSize of [0, Infinity, -1, 1.5]) expect(() => createRenderPerformanceMonitor({ sampleSize })).toThrow();
  });
});

it("retains hitch counts after percentile samples roll over", () => {
  let now = 0;
  const monitor = createRenderPerformanceMonitor({ now: () => now, sampleSize: 1 });
  monitor.end(0, { changedCells: 1 }); now = 100; monitor.end(0, { changedCells: 1 });
  now = 101; monitor.end(100, { changedCells: 1 });
  expect(monitor.snapshot()).toMatchObject({ slowFrames: 1, longestRenderMs: 100 });
});
