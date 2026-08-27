import { describe, expect, it, vi } from "vitest";

import { run } from "../run.js";
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
  it("rejects the first await immediately with the abort reason when pre-aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop before start");
    controller.abort(reason);

    const bindings = wrapCancelableBindings(
      {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(new Promise(() => undefined)),
          name: "wait"
        })
      },
      controller.signal
    );

    await expect(resolveSandboxPromise(resolveClosure(bindings, "wait").call([]))).rejects.toBe(
      reason
    );
  });

  it("yields to abort within one tick during a long microtask chain", async () => {
    const controller = new AbortController();
    const reason = new Error("abort during microtasks");
    let steps = 0;
    let chain = Promise.resolve("done");
    for (let index = 0; index < 1000; index += 1) {
      chain = chain.then((value) => {
        steps += 1;
        return value;
      });
    }
    const bindings = wrapCancelableBindings(
      {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(chain),
          name: "wait"
        })
      },
      controller.signal
    );
    const waitResult = resolveSandboxPromise(resolveClosure(bindings, "wait").call([]));

    queueMicrotask(() => {
      controller.abort(reason);
    });

    await expect(waitResult).rejects.toBe(reason);
    expect(steps).toBeLessThan(1000);
  });

  it("rejects an in-flight host call promise with the abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("host call aborted");
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
    controller.abort(reason);
    deferred.resolve("late");

    await expect(waitResult).rejects.toBe(reason);
  });

  it("returns a value when abort fires after the promise has already settled", async () => {
    const controller = new AbortController();
    const reason = new Error("too late");
    const bindings = wrapCancelableBindings(
      {
        done: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.resolve("done")),
          name: "done"
        })
      },
      controller.signal
    );

    const result = resolveSandboxPromise(resolveClosure(bindings, "done").call([]));
    controller.abort(reason);

    await expect(result).resolves.toBe("done");
  });

  it("treats repeated abort on the same signal as a no-op", async () => {
    const controller = new AbortController();
    const reason = new Error("first abort");
    const deferred = createDeferred<string>();
    const removals = trackAbortListeners(controller.signal).removals;
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
    controller.abort(reason);
    controller.abort(new Error("second abort"));
    deferred.resolve("done");

    await expect(waitResult).rejects.toBe(reason);
    expect(removals).toHaveBeenCalledTimes(1);
  });

  it("cleans up abort listeners after abort before the runner is reused", async () => {
    const firstController = new AbortController();
    const firstListeners = trackAbortListeners(firstController.signal);
    const firstDeferred = createDeferred<string>();
    const wait = createSandboxClosure({
      async: true,
      call: () => createSandboxPromise(firstDeferred.promise),
      name: "wait"
    });
    const firstBindings = wrapCancelableBindings({ wait }, firstController.signal);
    const firstResult = resolveSandboxPromise(resolveClosure(firstBindings, "wait").call([]));

    firstController.abort(new Error("first abort"));

    await expect(firstResult).rejects.toThrow("first abort");
    expect(firstListeners.active()).toBe(0);

    const secondController = new AbortController();
    const secondListeners = trackAbortListeners(secondController.signal);
    const secondBindings = wrapCancelableBindings(
      {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.resolve("second")),
          name: "wait"
        })
      },
      secondController.signal
    );
    const secondResult = resolveSandboxPromise(resolveClosure(secondBindings, "wait").call([]));
    secondController.abort(new Error("second abort"));

    await expect(secondResult).resolves.toBe("second");
    expect(secondListeners.active()).toBe(0);
  });

  it("uses an AbortError-shaped default reason", async () => {
    const controller = new AbortController();
    const bindings = wrapCancelableBindings(
      {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(new Promise(() => undefined)),
          name: "wait"
        })
      },
      controller.signal
    );
    const result = resolveSandboxPromise(resolveClosure(bindings, "wait").call([]));

    controller.abort();

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/abort/i),
        name: "AbortError"
      })
    );
  });
});

describe("run cancellation", () => {
  it.each([
    "return Array.from([1, 2], value => value * 2);",
    "const values = new Map([[1, 2]]); return [values.get(1), values instanceof Map];",
    "try { await Promise.any([Promise.reject(1)]); } catch (error) { return [error instanceof AggregateError, error.errors]; }"
  ])("preserves builtin behavior while a signal is armed: %s", async (source) => {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    expect(await run(source, { signal: new AbortController().signal })).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(source)()
    });
  });

  it("preserves async prefixes for source functions returned through a cancelable binding", async () => {
    const source =
      "let count = 0; const action = await identity(async () => { for (let index = 0; index < 16; index++) count++; await 0; }); const pending = action(); const prefix = count; await pending; return [prefix, count];";
    expect(
      await run(source, {
        bindings: { identity: (value: unknown) => value },
        signal: new AbortController().signal
      })
    ).toMatchObject({ ok: true, returnValue: [16, 16] });
  });

  it("can abort an empty builtin race without replacing builtin identities", async () => {
    const controller = new AbortController();
    const result = run("try { await Promise.race([]); } catch (error) { return error.name; }", {
      signal: controller.signal
    });
    queueMicrotask(() => controller.abort());
    expect(await result).toMatchObject({ ok: true, returnValue: "AbortError" });
  });

  it.each(["Promise.race([])", "{ then: () => undefined }"])(
    "can abort asynchronous return-value adoption: %s",
    async (value) => {
      const controller = new AbortController();
      const result = run(
        `const main = async () => (${value}); try { await main(); } catch (error) { return error.name; }`,
        { signal: controller.signal }
      );
      queueMicrotask(() => controller.abort());
      expect(await result).toMatchObject({ ok: true, returnValue: "AbortError" });
    }
  );

  // An armed signal wraps every host call in a second sandbox promise, so the
  // rejection the sandbox already caught must not also count as unhandled.
  it("keeps a caught host call rejection non-fatal while a signal is armed", async () => {
    const controller = new AbortController();
    const source = [
      'import { read } from "files";',
      "try {",
      "  await read();",
      "  return 'missed';",
      "} catch ({ code }) {",
      "  return 'caught:' + code;",
      "}"
    ].join("\n");
    const read = async () => {
      throw Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT"
      });
    };

    await expect(
      run(source, { modules: { files: { read } }, signal: controller.signal })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "caught:ENOENT"
    });
  });

  it("makes an abort during an in-flight host call catchable", async () => {
    const controller = new AbortController();
    const started = createDeferred<void>();
    const source = [
      'import { read } from "files";',
      "try {",
      "  await read();",
      "  return 'missed';",
      "} catch ({ name, message }) {",
      "  return name + ':' + message;",
      "}"
    ].join("\n");
    const read = async () => {
      started.resolve();
      return new Promise(() => undefined);
    };
    const result = run(source, { modules: { files: { read } }, signal: controller.signal });

    await started.promise;
    controller.abort();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "AbortError:This operation was aborted"
    });
  });

  it("does not start a second await when abort happens between two awaits", async () => {
    const controller = new AbortController();
    const first = createDeferred<string>();
    const firstStarted = createDeferred<void>();
    const second = vi.fn(() => createSandboxPromise(Promise.resolve("second")));
    const result = run(
      [
        "const firstValue = await first();",
        "try {",
        "  await second();",
        "  return 'missed';",
        "} catch ({ message }) {",
        "  return firstValue + ':' + message;",
        "}"
      ].join("\n"),
      {
        bindings: {
          first: createSandboxClosure({
            async: true,
            call: () => {
              firstStarted.resolve();
              return createSandboxPromise(first.promise);
            },
            name: "first"
          }),
          second: createSandboxClosure({
            async: true,
            call: () => second(),
            name: "second"
          })
        },
        signal: controller.signal
      }
    );

    await firstStarted.promise;
    first.resolve("first");
    controller.abort(new Error("between awaits"));

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "first:between awaits"
    });
    expect(second).not.toHaveBeenCalled();
  });

  it("makes abort errors catchable and inspectable at await points", async () => {
    const controller = new AbortController();
    const waitStarted = createDeferred<void>();
    const result = run(
      [
        "try {",
        "  await wait();",
        "} catch ({ name, message }) {",
        "  return name + ':' + message;",
        "}"
      ].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => {
              waitStarted.resolve();
              return createSandboxPromise(new Promise(() => undefined));
            },
            name: "wait"
          })
        },
        signal: controller.signal
      }
    );

    await waitStarted.promise;
    controller.abort();

    const finished = await result;
    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }

    const [name, message] = (finished.returnValue as string).split(":");
    expect(name).toBe("AbortError");
    expect(message).toMatch(/abort/i);
  });

  it("runs finally blocks when abort rejects an await", async () => {
    const controller = new AbortController();
    const waitStarted = createDeferred<void>();
    const result = run(
      [
        "let cleaned = false;",
        "try {",
        "  try {",
        "    await wait();",
        "  } finally {",
        "    cleaned = true;",
        "  }",
        "} catch ({ message }) {",
        "  return (cleaned ? 'clean' : 'dirty') + ':' + message;",
        "}"
      ].join("\n"),
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => {
              waitStarted.resolve();
              return createSandboxPromise(new Promise(() => undefined));
            },
            name: "wait"
          })
        },
        signal: controller.signal
      }
    );

    await waitStarted.promise;
    controller.abort(new Error("stop in finally test"));

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "clean:stop in finally test"
    });
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

function trackAbortListeners(signal: AbortSignal) {
  let active = 0;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  const removals = vi.fn();

  vi.spyOn(signal, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "abort") {
      active += 1;
    }

    return originalAdd(type, listener, options);
  });
  vi.spyOn(signal, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "abort" && active > 0) {
      active -= 1;
      removals();
    }

    return originalRemove(type, listener, options);
  });

  return {
    active: () => active,
    removals
  };
}
