import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { createSandboxClosure, createSandboxPromise } from "../values.js";

const callbackSites = [
  ...[
    "map",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
    "every",
    "forEach",
    "flatMap"
  ].map((method) => ({
    name: `Array.${method}`,
    source: "[2, 5, -1, 0]",
    call: `source.${method}(visit, receiver, { wrong: true })`,
    omitted: `source.${method}(visit)`
  })),
  {
    name: "Map.forEach",
    source: 'new Map([["first", 2], ["second", 5]])',
    call: "source.forEach(visit, receiver, { wrong: true })",
    omitted: "source.forEach(visit)"
  },
  {
    name: "Set.forEach",
    source: "new Set([2, 5, -1, 0])",
    call: "source.forEach(visit, receiver, { wrong: true })",
    omitted: "source.forEach(visit)"
  },
  {
    name: "Array.from",
    source: "[2, 5, -1, 0]",
    call: "Array.from(source, visit, receiver, { wrong: true })",
    omitted: "Array.from(source, visit)"
  }
];

describe.each(callbackSites)("$name callback this", ({ source: input, call, omitted }) => {
  it("preserves receiver identity, mutation, arguments, and complete native output", async () => {
    const source = `
      const source = ${input};
      const receiver = { scale: 3, calls: 0 };
      const seen = [];
      function visit(value, key, collection) {
        this.calls++;
        seen.push([this === receiver, value, key, collection === source, arguments.length]);
        return value * this.scale;
      }
      const result = ${call};
      return { result, seen, values: Array.from(source), receiver };
    `;
    const expected = Function('"use strict";\n' + source)();
    const original = await run(source);
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    const snapshot = JSON.parse(serializeSafeJSSnapshot(original.snapshot));
    await expect(run(source, { snapshot })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each(["undefined", "null", "false", "0", '"receiver"', "17"])(
    "preserves the exact %s receiver without coercion",
    async (receiver) => {
      const source = `
        const source = ${input};
        const receiver = ${receiver};
        const seen = [];
        function visit(value) {
          seen.push(this === receiver);
          return value;
        }
        const result = ${call};
        return { result, seen };
      `;
      const expected = Function('"use strict";\n' + source)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("uses undefined when thisArg is omitted", async () => {
    const source = `
      const source = ${input};
      const seen = [];
      function visit(value) {
        seen.push(this === undefined);
        return value;
      }
      const result = ${omitted};
      return { result, seen };
    `;
    const expected = Function('"use strict";\n' + source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["arrow", "bound"])("does not replace %s this", async (kind) => {
    const callback =
      kind === "arrow"
        ? "const visit = (value) => { seen.push(this === lexical); return value * this.scale; };"
        : `function callback(value) {
            seen.push(this === lexical);
            return value * this.scale;
          }
          const visit = callback.bind(lexical);`;
    const source = `
      const lexical = { scale: 7 };
      function outer() {
        const source = ${input};
        const receiver = { scale: 3 };
        const seen = [];
        ${callback}
        const result = ${call};
        return { result, seen };
      }
      return outer.call(lexical);
    `;
    const expected = Function('"use strict";\n' + source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("callback argument positions and replay", () => {
  it.each([
    ["map", "ordinary"],
    ["map", "arrow"],
    ["map", "bound"],
    ["from", "ordinary"],
    ["from", "arrow"],
    ["from", "bound"]
  ])("restores %s %s callback this across an active await checkpoint", async (method, kind) => {
    const callback = `async ${kind === "arrow" ? "(value, index) =>" : "function (value, index)"} {
      const before = this === receiver;
      await wait();
      return [before, this === receiver, value * this.scale, index];
    }`;
    const source = `
      const receiver = { scale: 3 };
      async function outer() {
        const values = [2, 5, -1, 0];
        const callback = ${callback};
        const visit = ${kind === "bound" ? "callback.bind(receiver)" : "callback"};
        const supplied = ${kind === "ordinary" ? "receiver" : "{ scale: 99 }"};
        return await Promise.all(${method === "map" ? "values.map(visit, supplied)" : "Array.from(values, visit, supplied)"});
      }
      return await outer.call(receiver);
    `;
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const expected = await new AsyncFunction("wait", source)(async () => undefined);
    let release!: (value: undefined) => void;
    const pending = new Promise<undefined>((resolve) => {
      release = resolve;
    });
    const original = run(source, {
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(pending),
          name: "wait"
        })
      }
    });
    let checkpoint;
    try {
      checkpoint = JSON.parse(await dump(original));
    } finally {
      release(undefined);
    }
    expect(checkpoint.pendingAwaits.length).toBeGreaterThan(0);
    await expect(original).resolves.toMatchObject({ ok: true, returnValue: expected });
    await expect(
      run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve(undefined)),
            name: "wait"
          })
        },
        snapshot: restore(checkpoint, { source })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["reduce", "reduceRight"])("keeps %s initialValue separate from this", async (method) => {
    const source = `
      const source = [2, 5, -1, 0];
      const initialValue = { total: 10 };
      const seen = [];
      const result = source.${method}(function (accumulator, value, index, array) {
        seen.push([this === undefined, accumulator === initialValue, index, array === source]);
        accumulator.total += value;
        return accumulator;
      }, initialValue, { wrong: true });
      return { result, initialValue, seen, same: result === initialValue, source };
    `;
    const expected = Function('"use strict";\n' + source)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["sort", "toSorted"])(
    "ignores extra %s comparator receiver arguments",
    async (method) => {
      const source = `
      const source = [5, 2, -1, 0];
      let correctThis = true;
      const result = source.${method}(function (left, right) {
        correctThis = correctThis && this === undefined;
        return left - right;
      }, { wrong: true });
      return { result, correctThis, source };
    `;
      const expected = Function('"use strict";\n' + source)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("keeps bound arguments and binding across completed replay", async () => {
    const source = `
      const receiver = { scale: 7 };
      function visit(prefix, value, index, array) {
        return [prefix, value * this.scale, index, array === values, this === receiver];
      }
      const values = [2, 5, -1, 0];
      return values.map(visit.bind(receiver, "bound"), { scale: 3 });
    `;
    const expected = Function('"use strict";\n' + source)();
    const original = await run(source);
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    const snapshot = JSON.parse(serializeSafeJSSnapshot(original.snapshot));
    await expect(run(source, { snapshot })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});
