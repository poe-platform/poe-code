import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { run } from "./run.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { createSandboxClosure, createSandboxPromise } from "./interp/values.js";

describe("generic Promise operations", () => {
  it.each(["effect();", "Promise.resolve().then(effect);", "await new Promise(() => {});"])(
    "stops %s after an ignored fatal async rejection",
    async (continuation) => {
      let effects = 0;
      let cleanups = 0;
      await expect(
        run(
          `try { (async () => { function recurse() { recurse(); } recurse(); })(); ${continuation} } finally { await Promise.resolve(); cleanup(); }`,
          {
            bindings: {
              effect: () => {
                effects++;
              },
              cleanup: () => {
                cleanups++;
              }
            },
            budget: new Budget({ maxCallDepth: 8 })
          }
        )
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
      expect(effects).toBe(0);
      expect(cleanups).toBe(1);
    }
  );

  it("allows rejection handlers to recover an ordinary aborted sandbox error", async () => {
    const fail = createSandboxClosure({
      call: () => createSandboxPromise(Promise.reject(new SandboxError("aborted")))
    });
    expect(
      await run("return await fail().catch(() => 'caught');", { bindings: { fail } })
    ).toMatchObject({ ok: true, returnValue: "caught" });
  });

  it.each([
    "new Promise(resolve => { failed.catch(resolve); })",
    "(async () => failed)()",
    "new Promise(resolve => resolve(failed))"
  ])("interrupts pending %s after fatal rejection without skipping cleanup", async (pending) => {
    let effects = 0;
    let cleanups = 0;
    const source = `try { const failed = (async () => { await 0; function recurse() { recurse(); } recurse(); })(); const pending = ${pending}; const fallback = async () => { for (let index = 0; index < 16; index++) await 0; effect(); return 'escaped'; }; return await Promise.race([pending, fallback()]); } finally { await Promise.resolve(); cleanup(); }`;
    await expect(
      run(source, {
        bindings: {
          effect: () => {
            effects++;
          },
          cleanup: () => {
            cleanups++;
          }
        },
        budget: new Budget({ maxCallDepth: 8 })
      })
    ).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded", budget: "callDepth" });
    expect(effects).toBe(0);
    expect(cleanups).toBe(1);
  });

  it.each(["resolve", "reject"])(
    "does not hide a fatal thenable budget after %s",
    async (settle) => {
      const source = `try { await Promise.resolve({ then(resolve, reject) { ${settle}(42); function recurse() { recurse(); } recurse(); } }); return 'fulfilled'; } catch (error) { return 'caught'; }`;
      await expect(run(source, { budget: new Budget({ maxCallDepth: 8 }) })).rejects.toMatchObject({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "callDepth"
      });
    }
  );

  it("limits a repeatedly self-resolving thenable by execution budget", async () => {
    const source =
      "const value = { then(resolve) { resolve(value); } }; try { await Promise.resolve(value); } catch (error) { return error.name; }";
    await expect(run(source, { budget: new Budget({ maxSteps: 128 }) })).rejects.toMatchObject({
      name: "SandboxError",
      code: "budgetExceeded",
      budget: "steps"
    });
  });

  it.each([
    ...["all", "allSettled", "any", "race"].map((method) => ({
      name: `${method} passes a missing resolver TypeError to a custom capability`,
      prototypeState: true,
      source: `let name; function Container(executor) { executor(() => {}, error => { name = error.name; }); } Promise.${method}.call(Container, []); return name;`
    })),
    ...["all", "allSettled", "any", "race"].map((method) => ({
      name: `${method} rejection callbacks receive a sandbox TypeError`,
      source: `return await Promise.${method}(1).catch(error => [error.name, error instanceof TypeError]);`
    })),
    {
      name: "a thenable may resolve to itself before eventually fulfilling",
      source:
        "let count = 0; const value = { then(resolve) { if (++count < 3) resolve(value); else resolve(42); } }; return await Promise.resolve(value);"
    },
    {
      name: "constructor captures a promise then before returning",
      source:
        "const pending = Promise.resolve(42); const result = new Promise(resolve => resolve(pending)); Promise.prototype.then = 42; return (await result) === pending;"
    },
    {
      name: "async return captures a promise then before returning",
      source:
        "const pending = Promise.resolve(42); const result = (async () => pending)(); Promise.prototype.then = 42; return (await result) === pending;"
    },
    {
      name: "reaction captures a promise then before the next job",
      source:
        "const pending = Promise.resolve(42); const result = Promise.resolve().then(() => pending); Promise.resolve().then(() => { Promise.prototype.then = 42; }); return (await result) === pending;"
    },
    {
      name: "async return preserves a promise whose then is not callable",
      source:
        "const pending = Promise.resolve(42); Promise.prototype.then = 42; const result = (async () => pending)(); return (await result) === pending;"
    },
    {
      name: "constructor detects self resolution through a thenable",
      source:
        "let pending; pending = new Promise(resolve => resolve({ then: finish => finish(pending) })); const fallback = async () => { for (let index = 0; index < 12; index++) await 0; return 'pending'; }; return await Promise.race([pending.catch(error => error.name), fallback()]);"
    },
    {
      name: "await preserves a promise fulfilled as an opaque value",
      source:
        "const pending = Promise.resolve(42); const result = pending.then(() => pending); Promise.prototype.then = 42; return (await result) === pending;"
    },
    {
      name: "catch on a custom then receiver",
      source:
        "const receiver = { value: 42, then(resolve, reject) { return reject(this.value); } }; return Promise.prototype.catch.call(receiver, reason => reason + 1);"
    },
    {
      name: "catch on an async then receiver",
      source:
        "let prefix = 0; const receiver = { async then(resolve, reject) { prefix++; await 0; return reject(42); } }; const pending = Promise.prototype.catch.call(receiver, reason => reason + 1); return [prefix, await pending];"
    },
    {
      name: "catch uses a replaced then",
      source:
        "const pending = Promise.resolve(42); Promise.prototype.then = function (resolve, reject) { return [this === pending, resolve === undefined, typeof reject]; }; return pending.catch(() => {});"
    },
    {
      name: "finally on a custom then receiver",
      source:
        "let count = 0; const receiver = { value: 42, then(resolve) { return resolve(this.value); } }; const pending = Promise.prototype.finally.call(receiver, () => { count++; return 13; }); return [count, await pending];"
    },
    {
      name: "finally preserves a rejection",
      source:
        "const receiver = { then(resolve, reject) { return reject(42); } }; try { await Promise.prototype.finally.call(receiver, () => 13); } catch (error) { return error; }"
    },
    {
      name: "finally adopts callback rejection",
      source:
        "const receiver = { then(resolve) { return resolve(42); } }; try { await Promise.prototype.finally.call(receiver, () => Promise.reject(13)); } catch (error) { return error; }"
    },
    {
      name: "finally awaits an async cleanup but exposes its prefix",
      source:
        "let count = 0; const receiver = { then(resolve) { return resolve(42); } }; const pending = Promise.prototype.finally.call(receiver, async () => { count++; await 0; count++; }); const prefix = count; return [prefix, await pending, count];"
    },
    {
      name: "finally exposes a synchronous callback throw through custom then",
      source:
        "const receiver = { then(resolve) { return resolve(42); } }; try { Promise.prototype.finally.call(receiver, () => { throw 13; }); } catch (error) { return error; }"
    },
    {
      name: "finally does not call a handler rejected by custom then",
      source:
        "let count = 0; const receiver = { then() { return 42; } }; const result = Promise.prototype.finally.call(receiver, () => { count++; }); return [result, count];"
    },
    {
      name: "finally passes noncallable handlers through",
      source:
        "const receiver = { then(resolve, reject) { return [resolve, reject, this === receiver]; } }; return Promise.prototype.finally.call(receiver, 42);"
    },
    {
      name: "finally uses a replaced then",
      source:
        "const pending = Promise.resolve(42); Promise.prototype.then = function (resolve, reject) { return [this === pending, typeof resolve, typeof reject]; }; return pending.finally(() => {});"
    },
    {
      name: "finally rejects a primitive constructor before calling then",
      source:
        "let calls = 0; const receiver = { constructor: 42, then() { calls++; } }; try { Promise.prototype.finally.call(receiver, 1); } catch (error) { return [error.name, calls]; }"
    },
    {
      name: "then rejects a primitive constructor",
      source:
        "const pending = Promise.resolve(42); Promise.prototype.constructor = 1; try { pending.then(); } catch (error) { return error.name; }"
    },
    {
      name: "resolve with a custom constructor",
      prototypeState: true,
      source:
        "function Container(executor) { executor(value => { this.value = value; }, reason => { this.reason = reason; }); } return Promise.resolve.call(Container, 42).value;"
    },
    {
      name: "reject with a custom constructor",
      prototypeState: true,
      source:
        "function Container(executor) { executor(value => { this.value = value; }, reason => { this.reason = reason; }); } return Promise.reject.call(Container, 42).reason;"
    },
    {
      name: "bound constructor resolution",
      source:
        "const Constructor = Promise.bind(null); const pending = Promise.resolve(42); const result = Promise.resolve.call(Constructor, pending); return [result === pending, await result];"
    },
    {
      name: "bound constructor rejection",
      source:
        "try { await Promise.reject.call(Promise.bind(null), 42); } catch (error) { return error; }"
    },
    {
      name: "constructor result override",
      prototypeState: true,
      source:
        "function Container(executor) { executor(() => {}, () => {}); return { answer: 42 }; } return Promise.resolve.call(Container, 13);"
    },
    {
      name: "undefined capability receiver",
      prototypeState: true,
      source:
        "let receiver; function Container(executor) { executor(function () { receiver = this; }, () => {}); } Promise.resolve.call(Container, 42); return receiver === undefined;"
    },
    {
      name: "ignored async resolving callback result",
      prototypeState: true,
      source:
        "let count = 0; function Container(executor) { executor(async () => { count++; await 0; count++; }, () => {}); } const result = Promise.resolve.call(Container, 42); const prefix = count; await 0; return [typeof result.then, prefix, count];"
    },
    {
      name: "synchronous resolving callback throw",
      prototypeState: true,
      source:
        "function Container(executor) { executor(() => { throw 42; }, () => {}); } try { Promise.resolve.call(Container, 1); } catch (error) { return error; }"
    },
    {
      name: "synchronous constructor throw",
      prototypeState: true,
      source:
        "function Container() { throw 42; } try { Promise.resolve.call(Container, 1); } catch (error) { return error; }"
    },
    {
      name: "missing capability functions",
      prototypeState: true,
      source:
        "function Container() {} try { Promise.reject.call(Container, 1); } catch (error) { return error.name; }"
    },
    {
      name: "noncallable capability functions",
      prototypeState: true,
      source:
        "function Container(executor) { executor(1, 2); } try { Promise.resolve.call(Container, 1); } catch (error) { return error.name; }"
    },
    {
      name: "repeated capability initialization",
      prototypeState: true,
      source:
        "function Container(executor) { executor(() => {}, () => {}); executor(() => {}, () => {}); } try { Promise.resolve.call(Container, 1); } catch (error) { return error.name; }"
    },
    {
      name: "undefined first capability initialization",
      prototypeState: true,
      source:
        "function Container(executor) { executor(undefined, undefined); executor(value => { this.value = value; }, () => {}); } return Promise.resolve.call(Container, 42).value;"
    },
    {
      name: "identity before checking constructability",
      source:
        "const receiver = {}; Promise.prototype.constructor = receiver; const pending = new Promise(resolve => resolve(42)); return Promise.resolve.call(receiver, pending) === pending;"
    }
  ])("matches native $name", async (testCase) => {
    const { source } = testCase;
    const expected = await new Promise<unknown>((complete, fail) => {
      runInNewContext(
        `(async () => { "use strict"; await 0; ${source} })().then(complete, fail);`,
        { complete, fail }
      );
    });
    let result = await run(source, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    const snapshot = JSON.parse(await dump(result));
    result = await run(source, {
      signal: new AbortController().signal,
      snapshot
    });
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    if ("prototypeState" in testCase && testCase.prototypeState) {
      const recaptured = JSON.parse(await dump(result));
      expect(recaptured.heap).toEqual(snapshot.heap);
      expect(recaptured.bindings).toEqual(snapshot.bindings);
    }
  });
});
