import path from "node:path";

export type RunQueueOutcome = "completed" | "failed" | "cancelled" | "paused";
export type RunQueueItemStatus = "pending" | "running" | RunQueueOutcome;

export type RunQueueItem = Readonly<{
  id: string;
  status: RunQueueItemStatus;
} & (
  | { kind: "plan"; path: string }
  | { kind: "message"; text: string; afterPlanId: string }
)>;

export type RunQueueSnapshot = Readonly<{
  status: "idle" | "running" | RunQueueOutcome;
  items: readonly RunQueueItem[];
  activePlanId?: string;
  activeItemId?: string;
}>;

export type RunQueue = ReturnType<typeof createRunQueue>;

/** A live, ordered sequence shared by harness runtimes and their interactive views. */
export function createRunQueue(options: {
  plans: readonly string[];
  afterEachPlan?: readonly string[];
  cwd?: string;
}) {
  const cwd = options.cwd ?? process.cwd();
  const afterEachPlan = (options.afterEachPlan ?? []).map((text) => {
    if (!text.trim()) throw new Error("Queued messages cannot be empty.");
    return text.trim();
  });
  const listeners = new Set<(snapshot: RunQueueSnapshot) => void>();
  const pendingValidations = new Set<Promise<void>>();
  let nextId = 0;
  let cursor = 0;
  let snapshot: RunQueueSnapshot = Object.freeze({ status: "idle", items: Object.freeze([]) });

  function publish(update: Partial<RunQueueSnapshot>): void {
    snapshot = Object.freeze({
      ...snapshot,
      ...update,
      ...(update.items ? { items: Object.freeze(update.items.map((item) => Object.freeze(item))) } : {})
    });
    for (const listener of listeners) listener(snapshot);
  }

  function assertAccepting(): void {
    if (snapshot.status !== "idle" && snapshot.status !== "running") {
      throw new Error("This run has finished. Start a new run to queue more work.");
    }
  }

  function enqueuePlan(planPath: string): string {
    assertAccepting();
    const trimmed = planPath.trim();
    if (!trimmed) throw new Error("Queued plan paths cannot be empty.");
    const absolutePath = path.resolve(cwd, trimmed);
    if (snapshot.items.some((item) => item.kind === "plan" && path.resolve(cwd, item.path) === absolutePath)) {
      throw new Error(`Plan is already queued: ${trimmed}`);
    }
    const id = `plan-${++nextId}`;
    const plan: RunQueueItem = { id, kind: "plan", path: trimmed, status: "pending" };
    const messages: RunQueueItem[] = afterEachPlan.map((text) => ({
      id: `message-${++nextId}`, kind: "message", text, afterPlanId: id, status: "pending"
    }));
    publish({ items: [...snapshot.items, plan, ...messages] });
    return id;
  }

  function enqueueMessage(text: string, afterPlanId?: string): string {
    assertAccepting();
    if (!text.trim()) throw new Error("Queued messages cannot be empty.");
    const target = afterPlanId ?? snapshot.activePlanId ?? snapshot.items.find((item) => item.kind === "plan")?.id;
    const planIndex = snapshot.items.findIndex((item) => item.kind === "plan" && item.id === target);
    if (planIndex === -1) throw new Error("Choose a queued plan for this message.");
    let insertionIndex = planIndex + 1;
    while (snapshot.items[insertionIndex]?.kind === "message") insertionIndex++;
    if (insertionIndex <= cursor) throw new Error("That plan has already finished. Choose the current or a later plan.");
    const id = `message-${++nextId}`;
    const item: RunQueueItem = {
      id, kind: "message", text: text.trim(), afterPlanId: target!, status: "pending"
    };
    publish({ items: [
      ...snapshot.items.slice(0, insertionIndex), item, ...snapshot.items.slice(insertionIndex)
    ] });
    return id;
  }

  /** Keep the run open while a submitted plan path is being validated. */
  async function enqueueValidatedPlan(planPath: string, validate: (path: string) => Promise<string>): Promise<string> {
    assertAccepting();
    const earlierSubmissions = [...pendingValidations];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    pendingValidations.add(pending);
    try {
      const validatedPath = await validate(planPath);
      // Validation may finish out of order; execution must retain submission order.
      await Promise.all(earlierSubmissions);
      return enqueuePlan(validatedPath);
    } finally {
      pendingValidations.delete(pending);
      release();
    }
  }

  async function run(runtime: {
    signal?: AbortSignal;
    /** Stop between items, preserving already completed and still pending work. */
    shouldPause?: () => boolean;
    execute(item: RunQueueItem): Promise<RunQueueOutcome>;
  }): Promise<RunQueueSnapshot> {
    if (snapshot.status === "running") throw new Error("This queue is already running.");
    assertAccepting();
    publish({ status: "running" });
    while (cursor < snapshot.items.length || pendingValidations.size > 0) {
      if (runtime.signal?.aborted) {
        publish({ status: "cancelled", activeItemId: undefined });
        return snapshot;
      }
      if (runtime.shouldPause?.()) {
        publish({ status: "paused", activeItemId: undefined });
        return snapshot;
      }
      if (cursor >= snapshot.items.length) {
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<void>((resolve) => {
          onAbort = resolve;
          if (runtime.signal?.aborted) resolve();
          else runtime.signal?.addEventListener("abort", onAbort, { once: true });
        });
        try {
          await Promise.race([...pendingValidations, aborted]);
        } finally {
          if (onAbort) runtime.signal?.removeEventListener("abort", onAbort);
        }
        continue;
      }
      const pending = snapshot.items[cursor]!;
      const active: RunQueueItem = { ...pending, status: "running" };
      publish({
        activePlanId: active.kind === "plan" ? active.id : active.afterPlanId,
        activeItemId: active.id,
        items: snapshot.items.map((item) => item.id === active.id ? active : item)
      });
      let outcome: RunQueueOutcome;
      try {
        const result = await runtime.execute(active);
        outcome = runtime.signal?.aborted ? "cancelled" : result;
      } catch (error) {
        outcome = runtime.signal?.aborted ? "cancelled" : "failed";
        publish({
          status: outcome,
          activeItemId: undefined,
          items: snapshot.items.map((item) => item.id === active.id ? { ...item, status: outcome } : item)
        });
        throw error;
      }
      publish({
        ...(outcome !== "completed" ? { status: outcome } : {}),
        activeItemId: undefined,
        items: snapshot.items.map((item) => item.id === active.id ? { ...item, status: outcome } : item)
      });
      if (outcome !== "completed") return snapshot;
      cursor++;
    }
    publish({ status: runtime.signal?.aborted ? "cancelled" : "completed", activeItemId: undefined });
    return snapshot;
  }

  for (const plan of options.plans) enqueuePlan(plan);

  return {
    getSnapshot: (): RunQueueSnapshot => snapshot,
    enqueuePlan,
    enqueueValidatedPlan,
    enqueueMessage,
    onChange(listener: (snapshot: RunQueueSnapshot) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    run
  };
}
