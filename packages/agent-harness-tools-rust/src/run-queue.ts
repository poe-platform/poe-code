import {native,type NativeResult} from "./native.js";
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
  const core = new native.NativeHarnessQueue();
  const cachedItems = new Map<string, RunQueueItem>();
  let itemsDirty=false;
  let snapshot: RunQueueSnapshot = Object.freeze({ status: "idle", items: Object.freeze([]) });
  type Update={-readonly [K in keyof RunQueueSnapshot]?:RunQueueSnapshot[K]};
  function cacheItem(item:RunQueueItem):RunQueueItem {
    const previous=cachedItems.get(item.id);
    if(previous?.status===item.status)return previous;
    Object.freeze(item);cachedItems.set(item.id,item);return item;
  }
  function getSnapshot():RunQueueSnapshot {
    if(itemsDirty){
      const items=Object.freeze(core.items.map(cacheItem));
      snapshot=Object.freeze({...snapshot,items});itemsDirty=false;
    }
    return snapshot;
  }
  function nativeUpdate(result:NativeResult):Update {
    if(result.error!==undefined)throw new Error(result.error);
    if(result.itemsChanged)itemsDirty=true;
    if(result.active)cacheItem(result.active);
    const update:Update={...result.update};
    if(Object.hasOwn(update,"activeItemId")&&update.activeItemId===null)update.activeItemId=undefined;
    return update;
  }

  function publish(update: Partial<RunQueueSnapshot>): void {
    snapshot = Object.freeze({
      ...snapshot,
      ...update,
      ...(update.items ? { items: Object.freeze(update.items.map((item) => Object.freeze(item))) } : {})
    });
    for (const listener of listeners) listener(getSnapshot());
  }

  function assertAccepting():void {
    nativeUpdate(core.assertAccepting());
  }
  function enqueuePlan(planPath:string):string {
    assertAccepting();const trimmed=planPath.trim();
    if(!trimmed)throw new Error("Queued plan paths cannot be empty.");
    const absolutePath=path.resolve(cwd,trimmed);
    const messages=afterEachPlan.map(text=>text);
    const result=core.enqueuePlan(trimmed,absolutePath,messages);
    publish(nativeUpdate(result));return result.value!;
  }
  function enqueueMessage(text:string,afterPlanId?:string):string {
    const result=core.enqueueMessage(text,afterPlanId??null);
    publish(nativeUpdate(result));return result.value!;
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
    publish(nativeUpdate(core.begin()));
    while (core.hasWork || pendingValidations.size > 0) {
      if (runtime.signal?.aborted) {
        publish(nativeUpdate(core.stop("cancelled")));
        return getSnapshot();
      }
      if (runtime.shouldPause?.()) {
        publish(nativeUpdate(core.stop("paused")));
        return getSnapshot();
      }
      if (!core.hasWork) {
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
      const activated=core.activate();
      publish(nativeUpdate(activated));
      const active=cacheItem(activated.active!);
      let outcome: RunQueueOutcome;
      try {
        const result = await runtime.execute(active);
        outcome = runtime.signal?.aborted ? "cancelled" : result;
      } catch (error) {
        outcome = runtime.signal?.aborted ? "cancelled" : "failed";
        const finished=core.finish(outcome);
        const update=nativeUpdate(finished);update.status=outcome;
        publish(update);
        throw error;
      }
      publish(nativeUpdate(core.finish(outcome)));
      if (outcome !== "completed") return getSnapshot();
      nativeUpdate(core.advance());
    }
    publish(nativeUpdate(core.stop(runtime.signal?.aborted ? "cancelled" : "completed")));
    return getSnapshot();
  }

  for (const plan of options.plans) enqueuePlan(plan);

  return {
    getSnapshot,
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
