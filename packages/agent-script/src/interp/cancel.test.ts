import { describe, expect, it, vi } from "vitest";

import { SandboxError } from "./budget.js";
import { wrapCancelableBindings } from "./cancel.js";
import {
  createSandboxClosure,
  createSandboxPromise,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxObject
} from "./values.js";

describe("wrapCancelableBindings", () => {
  it("rejects an in-flight await and blocks the next host call after abort", async () => {
    const controller = new AbortController();
    const after = vi.fn(() => "after");
    const deferred = createDeferred<string>();
    const bindings = wrapCancelableBindings(
      {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(deferred.promise),
          name: "wait"
        }),
        after: createSandboxClosure({
          call: () => after(),
          name: "after"
        })
      },
      controller.signal
    );

    const waitResult = resolveSandboxPromise(resolveClosure(bindings, "wait").call([]));
    controller.abort();

    await expect(waitResult).rejects.toEqual(
      expect.objectContaining({
        code: "aborted",
        message: "aborted",
        name: "SandboxError"
      } satisfies Partial<SandboxError>)
    );
    expect(() => resolveClosure(bindings, "after").call([])).toThrowError(
      expect.objectContaining({
        code: "aborted",
        message: "aborted",
        name: "SandboxError"
      } satisfies Partial<SandboxError>)
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("rejects wrapped promises immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const call = vi.fn(() => "value");
    const bindings = wrapCancelableBindings(
      {
        pending: createSandboxPromise(new Promise(() => undefined)),
        value: createSandboxClosure({
          call: () => call(),
          name: "value"
        })
      },
      controller.signal
    );

    await expect(resolveSandboxPromise(bindings.pending)).rejects.toEqual(
      expect.objectContaining({
        code: "aborted",
        message: "aborted",
        name: "SandboxError"
      } satisfies Partial<SandboxError>)
    );
    expect(() => resolveClosure(bindings, "value").call([])).toThrowError(
      expect.objectContaining({
        code: "aborted",
        message: "aborted",
        name: "SandboxError"
      } satisfies Partial<SandboxError>)
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("prefers abort over a later promise resolution", async () => {
    const controller = new AbortController();
    const deferred = createDeferred<string>();
    const bindings = wrapCancelableBindings(
      {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(deferred.promise),
          name: "wait"
        })
      },
      controller.signal
    );

    const waitResult = resolveSandboxPromise(resolveClosure(bindings, "wait").call([]));
    controller.abort();
    deferred.resolve("done");

    await expect(waitResult).rejects.toEqual(
      expect.objectContaining({
        code: "aborted",
        message: "aborted",
        name: "SandboxError"
      } satisfies Partial<SandboxError>)
    );
  });
});

function resolveClosure(bindings: SandboxObject, name: string): SandboxClosure {
  const closure = bindings[name];

  if (!isSandboxClosure(closure)) {
    throw new TypeError(`Expected ${name} to be a sandbox closure.`);
  }

  return closure;
}

function resolveSandboxPromise(value: unknown): Promise<unknown> {
  if (!isSandboxPromise(value)) {
    throw new TypeError("Expected a sandbox promise.");
  }

  return value.promise;
}

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;

  const promise = new Promise<TValue>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve
  };
}
