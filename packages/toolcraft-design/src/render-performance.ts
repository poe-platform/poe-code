import { fitToWidth } from "./explorer/render/text.js";

export interface RenderPercentiles { p50: number; p95: number; max: number }
export interface RenderPerformanceSnapshot {
  /** Rolling one-second repaint dispatch rate, with 10ms bucket resolution. */
  fps: number;
  frames: number;
  renders: number;
  requests: number;
  coalesced: number;
  changedCells: number;
  sampleCount: number;
  /** Paints exceeding the 60Hz frame budget (16.67ms), cumulative. */
  slowFrames: number;
  longestRenderMs: number;
  renderMs: RenderPercentiles;
  /** Time from oldest pending input to flush enqueue; terminal presentation is not observable. */
  inputMs: RenderPercentiles;
}

export function createRenderPerformanceMonitor(options: { now?: () => number; sampleSize?: number } = {}) {
  const now = options.now ?? (() => performance.now());
  const capacity = options.sampleSize ?? 256;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error("sampleSize must be an integer between 1 and 4096");
  const durations = new Float64Array(capacity);
  const inputs = new Float64Array(capacity);
  const buckets = new Float64Array(101).fill(-Infinity);
  const counts = new Uint32Array(101);
  let renders = 0, frames = 0, requests = 0, pending = 0, coalesced = 0, changedCells = 0;
  let inputCount = 0;
  let slowFrames = 0, longestRenderMs = 0;
  let firstInput: number | undefined;
  return {
    request(kind: "input" | "update" | "resize") {
      requests++; pending++;
      if (kind === "input") firstInput ??= now();
    },
    begin() { return now(); },
    end(startedAt: number, frame: { changedCells: number }) {
      const finished = now();
      const duration = Math.max(0, finished - startedAt);
      durations[renders % capacity] = duration;
      longestRenderMs = Math.max(longestRenderMs, duration);
      if (frame.changedCells > 0 && duration > 1000 / 60) slowFrames++;
      renders++;
      coalesced += Math.max(0, pending - 1);
      pending = 0;
      if (firstInput !== undefined) {
        inputs[inputCount++ % capacity] = Math.max(0, finished - firstInput);
        firstInput = undefined;
      }
      if (frame.changedCells > 0) {
        frames++; changedCells += frame.changedCells;
        const bucket = Math.floor(finished / 10);
        const index = bucket % buckets.length;
        if (buckets[index] !== bucket) { buckets[index] = bucket; counts[index] = 0; }
        counts[index] = counts[index]! + 1;
      }
    },
    snapshot(): RenderPerformanceSnapshot {
      const time = now();
      let fps = 0;
      for (let index = 0; index < buckets.length; index++) {
        if (buckets[index]! * 10 >= time - 1000 && buckets[index]! * 10 <= time) fps += counts[index]!;
      }
      return { fps, frames, renders, requests, coalesced, changedCells, slowFrames, longestRenderMs,
        sampleCount: Math.min(renders, capacity), renderMs: percentiles(durations, Math.min(renders, capacity)),
        inputMs: percentiles(inputs, Math.min(inputCount, capacity)) };
    }
  };
}

function percentiles(samples: Float64Array, count: number): RenderPercentiles {
  if (count === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = samples.slice(0, count).sort();
  return { p50: sorted[Math.ceil(count * .5) - 1]!, p95: sorted[Math.ceil(count * .95) - 1]!, max: sorted[count - 1]! };
}

export function formatRenderPerformance(stats: RenderPerformanceSnapshot, width: number): string {
  const value = `FPS ${stats.fps} · paint p95 ${stats.renderMs.p95.toFixed(1)}ms · input p95 ${stats.inputMs.p95.toFixed(1)}ms · slow ${stats.slowFrames} · merged ${stats.coalesced}`;
  return fitToWidth(value, width);
}
