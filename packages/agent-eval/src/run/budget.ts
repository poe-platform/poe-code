import type { Budget, SpawnUsage } from "../types.js";
import type { NormalizedTraceEvent } from "./trace/types.js";

type BudgetKey = keyof Budget;

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

  private iterationsTotal = 0;
  private pendingTrip: BudgetKey | undefined;
  private tripped: BudgetKey | undefined;

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
    if (event.type === "tool") {
      this.countToolIteration(event);
    }

    if (event.type === "usage") {
      this.addUsage(event.usage);
    }

    this.checkCaps();
  }

  snapshot(): { iterations: number; usage: SpawnUsage; elapsedMs: number; tripped?: keyof Budget } {
    const snapshot = {
      iterations: this.iterationsTotal,
      usage: { ...this.usageTotal },
      elapsedMs: Date.now() - this.startedAt,
      ...(this.tripped === undefined ? {} : { tripped: this.tripped })
    };
    return snapshot;
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
    if (this.tripped !== undefined || this.controller.signal.aborted) {
      return;
    }

    this.pendingTrip = budgetKey;
    this.controller.abort();
    if (this.tripped === undefined && this.controller.signal.aborted) {
      this.tripped = budgetKey;
    }
  }
}
