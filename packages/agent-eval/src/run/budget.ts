import type { Budget, SpawnUsage } from "../types.js";
import type { NormalizedTraceEvent } from "./trace/types.js";

type BudgetKey = keyof Budget;
type BudgetSnapshot = {
  iterations: number;
  usage: SpawnUsage;
  elapsedMs: number;
  tripped?: keyof Budget;
};

export class BudgetEnforcer {
  private readonly startedAt = Date.now();
  private readonly budget: Budget;
  private readonly controller: AbortController;
  private readonly wallTimer: ReturnType<typeof setTimeout>;
  private readonly usageTotal: SpawnUsage = {
    inputTokens: 0,
    outputTokens: 0
  };
  private readonly countedToolIds = new Set<string>();
  private readonly pendingIdlessTools = new Map<string, number>();

  private iterationsTotal = 0;
  private pendingTrip: BudgetKey | undefined;
  private tripped: BudgetKey | undefined;
  private completed: BudgetSnapshot | undefined;

  constructor(budget: Budget, controller: AbortController) {
    this.budget = budget;
    this.controller = controller;
    this.controller.signal.addEventListener(
      "abort",
      () => {
        this.tripped = this.pendingTrip;
        clearTimeout(this.wallTimer);
      },
      { once: true }
    );

    this.wallTimer = setTimeout(() => {
      this.trip("wallClockMs");
    }, budget.wallClockMs);

    const maybeTimer = this.wallTimer as { unref?: () => void };
    maybeTimer.unref?.();
  }

  onEvent(event: NormalizedTraceEvent): void {
    if (this.completed !== undefined) {
      return;
    }

    if (event.type === "tool") {
      this.countToolIteration(event);
    }

    if (event.type === "usage") {
      this.addUsage(event.usage);
    }

    this.checkCaps();
  }

  finalize(): BudgetSnapshot {
    if (this.completed === undefined) {
      clearTimeout(this.wallTimer);
      this.completed = this.currentSnapshot();
    }

    return copySnapshot(this.completed);
  }

  snapshot(): BudgetSnapshot {
    return this.completed === undefined ? this.currentSnapshot() : copySnapshot(this.completed);
  }

  private currentSnapshot(): BudgetSnapshot {
    return {
      iterations: this.iterationsTotal,
      usage: { ...this.usageTotal },
      elapsedMs: Date.now() - this.startedAt,
      ...(this.tripped === undefined ? {} : { tripped: this.tripped })
    };
  }

  private addUsage(usage: SpawnUsage): void {
    this.usageTotal.inputTokens += usage.inputTokens;
    this.usageTotal.outputTokens += usage.outputTokens;

    if (usage.cachedTokens !== undefined) {
      this.usageTotal.cachedTokens = (this.usageTotal.cachedTokens ?? 0) + usage.cachedTokens;
    }

    if (usage.costUsd !== undefined) {
      this.usageTotal.costUsd = (this.usageTotal.costUsd ?? 0) + usage.costUsd;
    }
  }

  private countToolIteration(event: Extract<NormalizedTraceEvent, { type: "tool" }>): void {
    if (event.id === undefined) {
      const key = `${event.operation}\u0000${event.name}`;
      const pendingStarts = this.pendingIdlessTools.get(key) ?? 0;
      if (event.phase === "complete" && pendingStarts > 0) {
        if (pendingStarts === 1) {
          this.pendingIdlessTools.delete(key);
        } else {
          this.pendingIdlessTools.set(key, pendingStarts - 1);
        }
        return;
      }

      if (event.phase === "start") {
        this.pendingIdlessTools.set(key, pendingStarts + 1);
      }

      this.iterationsTotal += 1;
      return;
    }

    if (this.countedToolIds.has(event.id)) {
      return;
    }

    this.countedToolIds.add(event.id);
    this.iterationsTotal += 1;
  }

  private checkCaps(): void {
    if (this.iterationsTotal >= this.budget.maxIterations) {
      this.trip("maxIterations");
      return;
    }

    if (this.usageTotal.inputTokens + this.usageTotal.outputTokens >= this.budget.maxTokens) {
      this.trip("maxTokens");
    }
  }

  private trip(budgetKey: BudgetKey): void {
    if (
      this.completed !== undefined ||
      this.tripped !== undefined ||
      this.controller.signal.aborted
    ) {
      return;
    }

    this.pendingTrip = budgetKey;
    this.controller.abort();
    if (this.tripped === undefined && this.controller.signal.aborted) {
      this.tripped = budgetKey;
    }
  }
}

function copySnapshot(snapshot: BudgetSnapshot): BudgetSnapshot {
  return {
    ...snapshot,
    usage: { ...snapshot.usage }
  };
}
