import { describe, expect, it, vi } from "vitest";
import { SandboxError } from "./budget.js";
import { createGeneratorChannel } from "./generator.js";
import { SandboxJobQueue, runAsyncPrefix, suspendJob } from "./jobs.js";
import { SandboxPromiseRejectionTracker } from "./promise-tracker.js";
import { createSandboxPromise, type SandboxValue } from "./values.js";

function rejected(
  tracker: SandboxPromiseRejectionTracker,
  owner: object | undefined,
  reason: SandboxValue
) {
  return tracker.withOperation(owner, () => {
    const promise = createSandboxPromise(Promise.reject(reason));
    tracker.track(promise);
    return promise;
  });
}

describe("promise rejection operation ownership", () => {
  it("checks its own records, excludes active others and keeps default checks global", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const source = tracker.startOperation();
    const callback = tracker.startOperation();
    const promise = rejected(tracker, source, "source-owned");
    expect(await tracker.findUnhandledRejection(callback)).toBeUndefined();
    expect(await tracker.findUnhandledRejection(source)).toMatchObject({ reason: "source-owned" });
    expect(await tracker.findUnhandledRejection()).toMatchObject({ reason: "source-owned" });
    tracker.observe(promise);
    expect(await tracker.findUnhandledRejection(callback)).toBeUndefined();
    tracker.finishOperation(source);
    tracker.finishOperation(callback);
  });

  it("does not attribute a second tracked outcome to a different operation", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const source = tracker.startOperation();
    const callback = tracker.startOperation();
    const promise = rejected(tracker, source, "source-owned");
    tracker.withOperation(callback, () => tracker.track(promise, promise.promise));
    expect(await tracker.findUnhandledRejection(callback)).toBeUndefined();
    tracker.finishOperation(source);
    expect(await tracker.findUnhandledRejection(callback)).toMatchObject({
      reason: "source-owned"
    });
    tracker.finishOperation(callback);
  });

  it("does not lose a rejection that occurs after its creation owner completed", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const earlier = tracker.startOperation();
    const later = tracker.startOperation();
    let reject!: (reason: unknown) => void;
    const pending = new Promise<SandboxValue>((_resolve, fail) => {
      reject = fail;
    });
    tracker.withOperation(earlier, () => tracker.track(createSandboxPromise(pending)));
    tracker.finishOperation(earlier);
    expect(await tracker.findUnhandledRejection(later)).toBeUndefined();
    reject("late rejection");
    expect(await tracker.findUnhandledRejection(later)).toMatchObject({ reason: "late rejection" });
    tracker.finishOperation(later);
  });

  it("tracks newly created late-continuation promises even after their owner completed", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const earlier = tracker.startOperation();
    const later = tracker.startOperation();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const continuation = tracker.withOperation(earlier, async () => {
      await gate;
      tracker.track(createSandboxPromise(Promise.reject("late continuation")));
    });
    tracker.finishOperation(earlier);
    resume();
    await continuation;
    expect(await tracker.findUnhandledRejection(later)).toMatchObject({
      reason: "late continuation"
    });
    tracker.finishOperation(later);
  });

  it("propagates attribution through queued and suspended jobs", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const source = tracker.startOperation();
    const callback = tracker.startOperation();
    const queue = new SandboxJobQueue();
    let resume!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      const task = tracker.withOperation(source, () =>
        queue.run(async () => {
          entered();
          await suspendJob(gate);
          tracker.track(createSandboxPromise(Promise.reject("queued continuation")));
        })
      );
      await entering;
      expect(await tracker.findUnhandledRejection(callback)).toBeUndefined();
      resume();
      await task;
      expect(await tracker.findUnhandledRejection(callback)).toBeUndefined();
      expect(await tracker.findUnhandledRejection(source)).toMatchObject({
        reason: "queued continuation"
      });
    } finally {
      resume();
      tracker.finishOperation(source);
      tracker.finishOperation(callback);
      queue.finish();
    }
  });

  it("changes resumed-frame attribution without changing an existing promise's owner", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const first = tracker.startOperation();
    const second = tracker.startOperation();
    const queue = new SandboxJobQueue();
    let original!: ReturnType<typeof createSandboxPromise>;
    const channel = createGeneratorChannel(async (yieldValue) => {
      original = createSandboxPromise(Promise.reject("original"));
      tracker.track(original);
      await yieldValue(0);
      tracker.track(original, original.promise);
      await runAsyncPrefix(async () => {
        tracker.track(createSandboxPromise(Promise.reject("resumed child")));
      });
      return 1;
    });
    try {
      await tracker.withOperation(first, () => queue.run(() => channel.next()));
      await tracker.withOperation(second, () => queue.run(() => channel.next()));
      expect(await tracker.findUnhandledRejection(second)).toMatchObject({
        reason: "resumed child"
      });
      expect(await tracker.findUnhandledRejection(first)).toMatchObject({ reason: "original" });
      tracker.observe(original);
      expect(await tracker.findUnhandledRejection(first)).toBeUndefined();
    } finally {
      tracker.finishOperation(first);
      tracker.finishOperation(second);
      queue.finish();
    }
  });

  it("keeps an independent async prefix with its origin when a later resumer releases its gate", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const first = tracker.startOperation();
    const second = tracker.startOperation();
    const queue = new SandboxJobQueue();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let continuation!: Promise<void>;
    const channel = createGeneratorChannel(async (yieldValue) => {
      continuation = runAsyncPrefix(async () => {
        await suspendJob(gate);
        tracker.track(createSandboxPromise(Promise.reject("independent continuation")));
      });
      await yieldValue(0);
      resume();
      return 1;
    });
    try {
      await tracker.withOperation(first, () => queue.run(() => channel.next()));
      await tracker.withOperation(second, () => queue.run(() => channel.next()));
      await continuation;
      expect(await tracker.findUnhandledRejection(second)).toBeUndefined();
      expect(await tracker.findUnhandledRejection(first)).toMatchObject({
        reason: "independent continuation"
      });
    } finally {
      resume();
      tracker.finishOperation(first);
      tracker.finishOperation(second);
      queue.finish();
    }
  });

  it("includes unowned rejections in an owned checkpoint", async () => {
    const tracker = new SandboxPromiseRejectionTracker();
    const callback = tracker.startOperation();
    rejected(tracker, undefined, "unowned");
    expect(await tracker.findUnhandledRejection(callback)).toMatchObject({ reason: "unowned" });
    tracker.finishOperation(callback);
  });

  it.each(["budget", "reentry"] as const)(
    "keeps %s failures realm-wide despite a different active owner",
    async (kind) => {
      const tracker = new SandboxPromiseRejectionTracker();
      const source = tracker.startOperation();
      const callback = tracker.startOperation();
      const notify = vi.fn();
      tracker.onFatalRejection(notify);
      const error =
        kind === "reentry"
          ? new SandboxError("reentry")
          : new SandboxError({ budget: "callDepth", current: 2, limit: 1 });
      tracker.withOperation(source, () =>
        tracker.track(createSandboxPromise(Promise.reject(error)))
      );
      await expect(tracker.findUnhandledRejection(callback)).rejects.toBe(error);
      expect(notify).toHaveBeenCalledWith(error);
      tracker.finishOperation(source);
      tracker.finishOperation(callback);
    }
  );
});
