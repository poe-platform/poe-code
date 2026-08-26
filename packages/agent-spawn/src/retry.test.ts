import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import type { AcpEvent } from "./acp/types.js";
import { createSpawnRetry } from "./retry.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("createSpawnRetry", () => {
  it("rejects both public channels promptly when events fail with the result pending", async () => {
    const attemptResult = deferred<{ exitCode: number }>();
    const eventCompletion = deferred<void>();
    const streamError = new Error("attempt stream failed");
    const spawnOnce = vi.fn(() => ({
      events: {
        async *[Symbol.asyncIterator](): AsyncGenerator<AcpEvent> {
          await eventCompletion.promise;
          yield { event: "agent_message", text: "finished" };
        }
      },
      result: attemptResult.promise
    }));
    const isRetryable = vi.fn(() => true);
    const handle = createSpawnRetry(spawnOnce)(
      "agent",
      {},
      {
        maxAttempts: 3,
        backoffMs: 0,
        isRetryable
      }
    );
    const resultRejected = vi.fn();
    const eventsRejected = vi.fn();
    void handle.result.catch(resultRejected);
    void handle.events[Symbol.asyncIterator]().next().catch(eventsRejected);

    eventCompletion.reject(streamError);
    await setImmediate();

    expect(resultRejected).toHaveBeenCalledExactlyOnceWith(streamError);
    expect(eventsRejected).toHaveBeenCalledExactlyOnceWith(streamError);

    attemptResult.reject(new Error("late attempt result failure"));
    await setImmediate();

    expect(resultRejected).toHaveBeenCalledExactlyOnceWith(streamError);
    expect(eventsRejected).toHaveBeenCalledExactlyOnceWith(streamError);
    expect(spawnOnce).toHaveBeenCalledTimes(1);
    expect(isRetryable).not.toHaveBeenCalled();
  });

  it("owns a late stream rejection after the result has rejected without retrying", async () => {
    const attemptResult = deferred<{ exitCode: number }>();
    const eventCompletion = deferred<void>();
    const resultError = new Error("attempt result failed");
    const spawnOnce = vi.fn(() => ({
      events: {
        async *[Symbol.asyncIterator](): AsyncGenerator<AcpEvent> {
          await eventCompletion.promise;
          yield { event: "agent_message", text: "finished" };
        }
      },
      result: attemptResult.promise
    }));
    const isRetryable = vi.fn(() => true);
    const handle = createSpawnRetry(spawnOnce)(
      "agent",
      {},
      {
        maxAttempts: 3,
        backoffMs: 0,
        isRetryable
      }
    );
    const resultRejected = vi.fn();
    const eventsRejected = vi.fn();
    void handle.result.catch(resultRejected);
    void handle.events[Symbol.asyncIterator]().next().catch(eventsRejected);

    attemptResult.reject(resultError);
    await setImmediate();

    expect(resultRejected).toHaveBeenCalledExactlyOnceWith(resultError);
    expect(eventsRejected).toHaveBeenCalledExactlyOnceWith(resultError);

    eventCompletion.reject(new Error("late attempt stream failure"));
    await setImmediate();

    expect(resultRejected).toHaveBeenCalledExactlyOnceWith(resultError);
    expect(eventsRejected).toHaveBeenCalledExactlyOnceWith(resultError);
    expect(spawnOnce).toHaveBeenCalledTimes(1);
    expect(isRetryable).not.toHaveBeenCalled();
  });

  it.each(["result", "events"] as const)(
    "waits for both channels when %s completes first on success",
    async (firstCompleted) => {
      const attemptResult = deferred<{ exitCode: number }>();
      const eventCompletion = deferred<void>();
      const expectedResult = { exitCode: 0 };
      const spawnOnce = vi.fn(() => ({
        events: {
          async *[Symbol.asyncIterator](): AsyncGenerator<AcpEvent> {
            await eventCompletion.promise;
            yield { event: "agent_message", text: "finished" };
          }
        },
        result: attemptResult.promise
      }));
      const handle = createSpawnRetry(spawnOnce)(
        "agent",
        {},
        {
          maxAttempts: 3,
          backoffMs: 0
        }
      );
      const resultResolved = vi.fn();
      const eventsClosed = vi.fn();
      const receivedEvents: AcpEvent[] = [];
      const observedResult = handle.result.then(resultResolved);
      const observedEvents = (async () => {
        for await (const event of handle.events) {
          receivedEvents.push(event);
        }
        eventsClosed();
      })();

      if (firstCompleted === "result") {
        attemptResult.resolve(expectedResult);
      } else {
        eventCompletion.resolve();
      }
      await setImmediate();

      expect(resultResolved).not.toHaveBeenCalled();
      expect(eventsClosed).not.toHaveBeenCalled();

      attemptResult.resolve(expectedResult);
      eventCompletion.resolve();
      await Promise.all([observedResult, observedEvents]);

      expect(await handle.result).toBe(expectedResult);
      expect(resultResolved).toHaveBeenCalledExactlyOnceWith(expectedResult);
      expect(eventsClosed).toHaveBeenCalledTimes(1);
      expect(receivedEvents).toEqual([{ event: "agent_message", text: "attempt: 1 finished" }]);
      expect(spawnOnce).toHaveBeenCalledTimes(1);
    }
  );
});
