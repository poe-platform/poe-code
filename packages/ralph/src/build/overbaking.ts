export type OverbakingIterationStatus = "success" | "failure" | "incomplete";

export type OverbakingEvent = {
  storyId: string;
  consecutiveFailures: number;
  threshold: number;
  overbaked: boolean;
  shouldWarn: boolean;
};

type StoryFailureState = {
  consecutiveFailures: number;
  warned: boolean;
};

export class OverbakingDetector {
  readonly threshold: number;
  private readonly failuresByStoryId = new Map<string, StoryFailureState>();

  constructor(options?: { threshold?: number }) {
    const threshold = options?.threshold ?? 3;
    if (!Number.isFinite(threshold) || threshold < 1 || !Number.isInteger(threshold)) {
      throw new Error(`Invalid overbaking threshold "${String(options?.threshold)}". Expected an integer >= 1.`);
    }
    this.threshold = threshold;
  }

  record(storyId: string, status: OverbakingIterationStatus): OverbakingEvent {
    const existing = this.failuresByStoryId.get(storyId) ?? {
      consecutiveFailures: 0,
      warned: false
    };

    if (status === "success") {
      if (existing.consecutiveFailures !== 0 || existing.warned) {
        this.failuresByStoryId.set(storyId, { consecutiveFailures: 0, warned: false });
      }
      return {
        storyId,
        consecutiveFailures: 0,
        threshold: this.threshold,
        overbaked: false,
        shouldWarn: false
      };
    }

    const consecutiveFailures = existing.consecutiveFailures + 1;
    const overbaked = consecutiveFailures >= this.threshold;
    const shouldWarn = overbaked && !existing.warned;
    this.failuresByStoryId.set(storyId, {
      consecutiveFailures,
      warned: shouldWarn ? true : existing.warned
    });

    return {
      storyId,
      consecutiveFailures,
      threshold: this.threshold,
      overbaked,
      shouldWarn
    };
  }
}
