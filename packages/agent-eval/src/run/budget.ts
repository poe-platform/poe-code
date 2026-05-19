import type { Budget, SpawnEvent, SpawnUsage } from "../types.js";

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

  private iterationsTotal = 0;
  private pendingTrip: BudgetKey | undefined;
  private tripped: BudgetKey | undefined;

  constructor(budget: Budget, controller: AbortController) {
    this.budget = budget;
    this.controller = controller;
    this.controller.signal.addEventListener("abort", () => {
      this.tripped = this.pendingTrip;
      clearTimeout(this.wallTimer);
    }, { once: true });

    this.wallTimer = setTimeout(() => {
      this.trip("wallClockMs");
    }, budget.wallClockMs);

    const maybeTimer = this.wallTimer as { unref?: () => void };
    maybeTimer.unref?.();
  }

  onEvent(event: SpawnEvent): void {
    if (isToolCallEvent(event)) {
      this.iterationsTotal += 1;
    }

    const usage = readUsage(event);
    if (usage !== undefined) {
      this.addUsage(usage);
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

function isToolCallEvent(event: SpawnEvent): boolean {
  return (
    (isRecord(event) && event.sessionUpdate === "tool_call") ||
    (isRecord(event) && event.event === "tool_start")
  );
}

function readUsage(event: SpawnEvent): SpawnUsage | undefined {
  if (isRecord(event) && event.event === "usage") {
    const inputTokens = readNumber(event.inputTokens);
    const outputTokens = readNumber(event.outputTokens);
    if (inputTokens === undefined || outputTokens === undefined) {
      return undefined;
    }

    return readOptionalUsage({
      inputTokens,
      outputTokens,
      cachedTokens: event.cachedTokens,
      costUsd: event.costUsd
    });
  }

  if (isRecord(event) && event.sessionUpdate === "usage_update") {
    const meta = isRecord(event._meta) ? event._meta : {};
    const used = readNumber(event.used);
    const size = readNumber(event.size);
    if (used === undefined || size === undefined) {
      return undefined;
    }

    const inputTokens = readNumber(meta.inputTokens) ?? used;
    const outputTokens = readNumber(meta.outputTokens) ?? 0;
    const cachedTokens = readNumber(meta.cachedTokens) ?? Math.max(0, size - used);
    const cost = isRecord(event.cost) && event.cost.currency === "USD"
      ? readNumber(event.cost.amount)
      : undefined;

    return readOptionalUsage({
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd: cost
    });
  }

  return undefined;
}

function readOptionalUsage(input: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: unknown;
  costUsd?: unknown;
}): SpawnUsage {
  const usage: SpawnUsage = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens
  };

  const cachedTokens = readNumber(input.cachedTokens);
  if (cachedTokens !== undefined) {
    usage.cachedTokens = cachedTokens;
  }

  const costUsd = readNumber(input.costUsd);
  if (costUsd !== undefined) {
    usage.costUsd = costUsd;
  }

  return usage;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
