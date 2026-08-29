import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { createSandboxClosure, createSandboxPromise } from "../values.js";

describe("CTX-001 independent validation", () => {
  it.each([
    "map",
    "forEach",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
    "every",
    "flatMap"
  ])("keeps callback and receiver aliases distinct across successive %s calls", async (method) => {
    const source = `
      const values = [3, 1, 4];
      const first = { tag: "first", total: 0 };
      const second = { tag: "second", total: 0 };
      const receivers = { first, second };
      const seen = [];
      let expectedReceiver = first;
      function visit(value, index, collection) {
        this.total += value;
        seen.push([this.tag, this === expectedReceiver, value, index,
          collection === values, arguments.length]);
        return this.tag === "first" ? value >= 3 : value < 3;
      }
      const callbacks = { visit };
      const alias = callbacks.visit;
      const firstResult = values.${method}(alias, receivers.first, second);
      expectedReceiver = second;
      const secondResult = values.${method}(callbacks.visit, receivers.second, first);
      return { firstResult, secondResult, seen, first, second, values };
    `;
    const expected = runInNewContext(
      `"use strict"; (function() { ${source} })()`,
      {},
      {
        timeout: 1_000
      }
    );
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(expected);
  });

  it.each([
    ["Map", 'new Map([["left", 3], ["right", 4]])'],
    ["Set", "new Set([3, 4])"]
  ])(
    "preserves %s callback key/value positions and shared receiver identity",
    async (_kind, input) => {
      const source = `
      const values = ${input};
      const first = { label: "first", calls: 0 };
      const second = { label: "second", calls: 0 };
      const alias = { values, receiver: first };
      const trace = [];
      function visit(value, key, collection) {
        this.calls++;
        trace.push([value, key, collection === values, collection === alias.values,
          this.label, this === alias.receiver, arguments.length]);
      }
      const callbackAlias = visit;
      const firstResult = alias.values.forEach(callbackAlias, alias.receiver, second);
      alias.receiver = second;
      const secondResult = values.forEach(callbackAlias, alias.receiver, first);
      return { firstResult, secondResult, trace, first, second };
    `;
      const expected = runInNewContext(
        `"use strict"; (function() { ${source} })()`,
        {},
        {
          timeout: 1_000
        }
      );
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(expected);
    }
  );

  it.each([
    ["array", "[3, 1]"],
    ["array-like", "{ 0: 3, 1: 1, length: 2 }"],
    ["string", '"ab"'],
    ["set", "new Set([3, 1])"],
    ["map", 'new Map([["left", 3], ["right", 1]])'],
    ["generator", "(function* entries() { yield 3; yield 1; })()"]
  ])(
    "uses Array.from argument three and exactly two callback arguments for %s",
    async (_kind, input) => {
      const source = `
      const input = ${input};
      const receiver = { tag: "receiver", count: 0 };
      const alias = receiver;
      const trace = [];
      function visit(value, index, absent) {
        this.count++;
        trace.push([this === alias, this.tag, value, index, absent, arguments.length]);
        return [value, index, this.tag];
      }
      const convert = Array.from;
      const callbackAlias = visit;
      const output = convert(input, callbackAlias, alias, { tag: "wrong" });
      return { output, trace, receiver };
    `;
      const expected = runInNewContext(
        `"use strict"; (function() { ${source} })()`,
        {},
        {
          timeout: 1_000
        }
      );
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(expected);
    }
  );

  it.each(["undefined", "null", "false", "0", "-0", '""', '"text"', "NaN"])(
    "does not box or substitute the strict %s receiver at any supported site",
    async (receiver) => {
      const source = `
        const receiver = ${receiver};
        const values = [3, 1];
        const outputs = [];
        let trace = [];
        function visit(value, key, collection) {
          trace.push([typeof this, this === receiver || (this !== this && receiver !== receiver),
            receiver === 0 ? 1 / this : 0, value, key, arguments.length]);
          return value;
        }
        for (const method of ["map", "forEach", "filter", "find", "findIndex",
          "findLast", "findLastIndex", "some", "every", "flatMap"]) {
          trace = [];
          const result = values[method](visit, receiver, { wrong: true });
          outputs.push([method, result, trace]);
        }
        trace = [];
        new Map([["key", 3]]).forEach(visit, receiver, { wrong: true });
        outputs.push(["Map", trace]);
        trace = [];
        new Set([3]).forEach(visit, receiver, { wrong: true });
        outputs.push(["Set", trace]);
        trace = [];
        const converted = Array.from(values, visit, receiver, { wrong: true });
        outputs.push(["from", converted, trace]);
        return outputs;
      `;
      const expected = runInNewContext(
        `"use strict"; (function() { ${source} })()`,
        {},
        {
          timeout: 1_000
        }
      );
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(expected);
    }
  );

  it.each(["reduce", "reduceRight"])(
    "keeps %s initial values separate from ordinary and bound callback receivers",
    async (method) => {
      const source = `
        const values = [3, 1, 4];
        const trace = [];
        function ordinary(accumulator, value, index, collection) {
          trace.push([this === undefined, accumulator, value, index,
            collection === values, arguments.length]);
          return (accumulator === undefined ? 0 : accumulator) + value;
        }
        const omitted = values.${method}(ordinary);
        const explicitUndefined = values.${method}(ordinary, undefined, { wrong: true });
        const receiver = { calls: 0 };
        const initial = { total: 10 };
        function boundVisit(prefix, accumulator, value, index, collection) {
          this.calls++;
          trace.push([prefix, this === receiver, accumulator === initial, value,
            index, collection === values, arguments.length]);
          accumulator.total += value;
          return accumulator;
        }
        const bound = boundVisit.bind(receiver, "prefix").bind({ wrong: true });
        const result = values.${method}(bound, initial, { wrong: true });
        return { omitted, explicitUndefined, trace, receiver, initial, same: result === initial };
      `;
      const expected = runInNewContext(
        `"use strict"; (function() { ${source} })()`,
        {},
        {
          timeout: 1_000
        }
      );
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(expected);
    }
  );

  it.each(["map", "from", "Map", "Set"])(
    "keeps aliased lexical arrows and repeatedly bound functions stable at %s",
    async (method) => {
      const input =
        method === "Map" ? 'new Map([["key", 3]])' : method === "Set" ? "new Set([3])" : "[3]";
      const invocation =
        method === "from"
          ? "Array.from(values, visit, wrong)"
          : method === "map"
            ? "values.map(visit, wrong)"
            : "values.forEach(visit, wrong)";
      const source = `
        const lexical = { tag: "lexical" };
        const boundReceiver = { tag: "bound" };
        const wrong = { tag: "wrong" };
        const values = ${input};
        const seen = [];
        function factory() {
          return (value, key) => {
            seen.push([this === lexical, this.tag, value, key]);
            return value;
          };
        }
        const arrow = factory.call(lexical);
        const aliases = { arrow };
        let visit = aliases.arrow.bind(wrong);
        const arrowResult = ${invocation};
        function ordinary(prefix, value, key) {
          seen.push([this === boundReceiver, this.tag, prefix, value, key]);
          return value;
        }
        visit = ordinary.bind(boundReceiver, "prefix").bind(wrong);
        const boundResult = ${invocation};
        return { arrowResult, boundResult, seen };
      `;
      const expected = runInNewContext(
        `"use strict"; (function() { ${source} })()`,
        {},
        {
          timeout: 1_000
        }
      );
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(expected);
    }
  );

  it.each(["map", "forEach", "Map", "Set", "from"])(
    "preserves two receiver identities across an active %s checkpoint and replay",
    async (method) => {
      const input =
        method === "Map"
          ? 'new Map([["left", 3], ["right", 1]])'
          : method === "Set"
            ? "new Set([3, 1])"
            : "[3, 1]";
      const invocation =
        method === "from"
          ? "Array.from(values, collect, receiver)"
          : method === "map"
            ? "values.map(collect, receiver)"
            : "values.forEach(collect, receiver)";
      const source = `
        const values = ${input};
        const first = { tag: "first", calls: 0 };
        const second = { tag: "second", calls: 0 };
        const aliases = [first, second];
        const jobs = [];
        function collect(value, key, collection) {
          this.calls++;
          const before = [this === first, this === second, this.tag,
            value, key, collection === values, arguments.length];
          const job = (async () => {
            await wait();
            return [before, this === aliases[0], this === aliases[1], this.tag];
          })();
          jobs.push(job);
          return job;
        }
        let receiver = aliases[0];
        ${invocation};
        receiver = aliases[1];
        ${invocation};
        const results = await Promise.all(jobs);
        return { results, first, second, distinct: first !== second };
      `;
      const expected = await runInNewContext(
        `"use strict"; (async function() { ${source} })()`,
        { wait: async () => undefined },
        { timeout: 1_000 }
      );
      let release!: (value: undefined) => void;
      const pending = new Promise<undefined>((resolve) => {
        release = resolve;
      });
      const original = run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            name: "wait",
            call: () => createSandboxPromise(pending)
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
      const initial = await original;
      expect(initial.ok).toBe(true);
      if (!initial.ok) throw initial.error;
      expect(initial.returnValue).toEqual(expected);
      const replay = await run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            name: "wait",
            call: () => createSandboxPromise(Promise.resolve(undefined))
          })
        },
        snapshot: restore(checkpoint, { source })
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw replay.error;
      expect(replay.returnValue).toEqual(expected);
    }
  );
});
