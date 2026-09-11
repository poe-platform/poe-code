import { AsyncLocalStorage } from "node:async_hooks";
import { expect, it, vi } from "vitest";
import { HostCallJournal, type HostCallResumeProof } from "./host-call.js";
import { activePromiseTracker, SandboxPromiseRejectionTracker } from "./promise-tracker.js";
import { promiseReplayContext, PromiseReplay } from "./promise-replay.js";
import { activeCancellation } from "./cancel.js";
import { runResources } from "./resources.js";

it("detaches inert provider reactions from guest state while preserving caller and continuation contexts", async () => {
  const caller = new AsyncLocalStorage<string>();
  const tracker = new SandboxPromiseRejectionTracker();
  const scheduling = new PromiseReplay();
  const signal = new AbortController().signal;
  const cancellation = { signal, host: true };
  const resources = { signal, referenceReleases: new Set<() => void>(), add: vi.fn() };
  const observe = vi.fn();
  await caller.run("caller", () => runResources.run(resources, () =>
    activeCancellation.run(cancellation, () => activePromiseTracker.run(tracker, () =>
      promiseReplayContext.run(scheduling, async () => {
        const journal = new HostCallJournal("source", [], request => {
          expect(caller.getStore()).toBe("caller");
          expect(activePromiseTracker.getStore()).toBe(tracker);
          expect(promiseReplayContext.getStore()).toBe(scheduling);
          const work = Promise.resolve<HostCallResumeProof>({ ...request, outcome: { status: "fulfilled", value: 7 } });
          const then = work.then;
          Object.defineProperty(work, "then", { value: function (this: Promise<HostCallResumeProof>, ...args: Parameters<typeof then>) {
            observe({ caller: caller.getStore(), tracker: activePromiseTracker.getStore(),
              scheduling: promiseReplayContext.getStore(), cancellation: activeCancellation.getStore(),
              resources: runResources.getStore() });
            return then.apply(this, args);
          } });
          return work;
        });
        const record = journal.issue({ moduleId: "host", operation: "read", argumentDigest: "args", policy: "read-side-effect" }).record;
        record.lifecycle = "running";
        try {
          await expect(journal.reconcile(record)).resolves.toEqual({ status: "fulfilled", value: 7 });
          expect(observe).toHaveBeenCalledExactlyOnceWith({ caller: "caller", tracker: undefined,
            scheduling: undefined, cancellation: undefined, resources: undefined });
          expect(caller.getStore()).toBe("caller");
          expect(activePromiseTracker.getStore()).toBe(tracker);
          expect(promiseReplayContext.getStore()).toBe(scheduling);
          expect(activeCancellation.getStore()).toBe(cancellation);
          expect(runResources.getStore()).toBe(resources);
        } finally {
          journal.dispose();
        }
      })
    ))
  ));
});
