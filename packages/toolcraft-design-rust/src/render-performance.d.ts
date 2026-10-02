export interface RenderPercentiles {
    p50: number;
    p95: number;
    max: number;
}
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
export declare function createRenderPerformanceMonitor(options?: {
    now?: () => number;
    sampleSize?: number;
}): {
    request(kind: "input" | "update" | "resize"): void;
    begin(): number;
    end(startedAt: number, frame: {
        changedCells: number;
    }): void;
    snapshot(): RenderPerformanceSnapshot;
};
export declare function formatRenderPerformance(stats: RenderPerformanceSnapshot, width: number): string;
