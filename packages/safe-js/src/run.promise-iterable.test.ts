import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { Budget } from "./interp/budget.js";
import { run } from "./run.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("Promise iterable aggregation", () => {
  it.each(["race", "any"])(
    "orders %s cleanup promises without extra adoption jobs",
    async (method) => {
      const source = `return await Promise.${method}([Promise.resolve("left").finally(async () => { await 0; }), Promise.resolve("right").finally(() => Promise.resolve())]);`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each(
    ["race", "any"].flatMap((method) =>
      [
        '(async () => Promise.resolve("right"))()',
        'new Promise(resolve => resolve(Promise.resolve("right")))'
      ].map((candidate) => ({ method, candidate }))
    )
  )("orders $method adoption through $candidate", async ({ method, candidate }) => {
    const source = `return await Promise.${method}([(async () => { await 0; return "left"; })(), ${candidate}]);`;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: await new AsyncFunction(source)()
    });
  });

  it.each(
    ["race", "any"].flatMap((method) =>
      [
        {
          candidate: '(async () => { await 0; return "left"; })()',
          competitor: 'Promise.race(new Set([Promise.resolve("right")]))'
        },
        {
          candidate: 'Promise.resolve({ then: resolve => resolve("left") })',
          competitor: 'Promise.race(new Set([Promise.resolve("right")]))'
        },
        {
          candidate: 'Promise.resolve().then(() => "left")',
          competitor: 'Promise.race(new Set([Promise.resolve("right")]))'
        },
        {
          candidate: 'Promise.resolve("left").finally(() => 0)',
          competitor:
            'Promise.all((function* () { yield Promise.resolve("right"); })()).then(values => values[0])'
        }
      ].map((entry) => ({ method, ...entry }))
    )
  )(
    "orders nested $method reactions with $candidate",
    async ({ method, candidate, competitor }) => {
      const source = `return await Promise.${method}([${candidate}, ${competitor}]);`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each(
    ["all", "allSettled", "race", "any"].flatMap((method) =>
      [
        "new Set([Promise.resolve(1), 2])",
        "new Map([[1, 2], [3, 4]])",
        "(function* () { yield Promise.resolve(1); yield 2; })()"
      ].map((iterable) => ({ method, iterable }))
    )
  )("matches native $method with $iterable", async ({ method, iterable }) => {
    const source = `return await Promise.${method}(${iterable});`;
    const expected = await new AsyncFunction(source)();
    let result = await run(source, { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    result = await run(source, { snapshot: JSON.parse(await dump(result)) });
    expect(result).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["all", "allSettled", "race", "any"])(
    "%s consumes a generator before returning to its caller",
    async (method) => {
      const source = `const order = []; function* values() { order.push('first'); yield Promise.resolve(1); order.push('second'); yield 2; order.push('end'); } const pending = Promise.${method}(values()); order.push('caller'); return [order, await pending];`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it.each(["all", "allSettled", "race", "any"])(
    "%s rejects with a synchronous iterator failure before fulfilled candidates",
    async (method) => {
      const source = `function* values() { yield Promise.resolve(1); throw 42; } let pending; try { pending = Promise.${method}(values()); } catch (error) { return 'synchronous'; } try { await pending; } catch (error) { return error; }`;
      expect(await run(source)).toMatchObject({
        ok: true,
        returnValue: await new AsyncFunction(source)()
      });
    }
  );

  it("does not hide a fatal iterator budget without an explicit await", async () => {
    await expect(
      run("function* values() { while (true) yield 1; } return Promise.race(values());", {
        budget: new Budget({ maxSteps: 40 })
      })
    ).rejects.toMatchObject({ name: "SandboxError", code: "budgetExceeded", budget: "steps" });
  });

  it("handles earlier rejections when iteration subsequently throws", async () => {
    const source =
      "function* values() { yield Promise.reject(13); throw 42; } try { await Promise.all(values()); } catch (error) { return error; }";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: 42 });
    await new Promise((resolve) => setImmediate(resolve));
  });
});
