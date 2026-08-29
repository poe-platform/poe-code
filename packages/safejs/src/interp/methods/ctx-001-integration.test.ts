import { describe, expect, it } from "vitest";

import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { createSandboxClosure, createSandboxPromise } from "../values.js";

const cases = [
  {
    name: "keeps distinct receivers across aliased nested reads",
    source: `
      const values = [2, 3];
      const alias = values;
      const outer = { total: 0 };
      const inner = { total: 10 };
      const result = values.map(function (left) {
        this.total += left;
        const same = this === outer;
        return alias.map(function (right) {
          this.total += left * right;
          return [same, this === inner, left * right];
        }, inner);
      }, outer);
      values.push(4);
      return { result, outer, inner, values, same: alias === values };
    `
  },
  {
    name: "preserves nested arrow and bound receivers and reduce initialValue",
    source: `
      const values = [2, 3];
      const outer = { label: "outer" };
      const bound = { label: "bound" };
      function visit(prefix, value) { return [prefix, value, this.label]; }
      const callback = visit.bind(bound, "fixed");
      return values.map(function (left) {
        const lexical = values.map(right => [left + right, this === outer]);
        const initial = { total: 10 };
        const sum = values.reduce(function (accumulator, value) {
          accumulator.total += value;
          if (this !== undefined) throw new Error("reduce receiver");
          return accumulator;
        }, initial, outer);
        return { lexical, bound: values.map(callback, outer), sum,
          same: sum === initial, arity: callback.length };
      }, outer);
    `
  },
  {
    name: "preserves published Object.entries aliases through Array.from receivers",
    source: `
      const original = { first: { score: 2 }, second: { score: 3 } };
      const entries = Object.entries(original);
      const receiver = { step: 4, calls: 0 };
      const result = Array.from(entries, function (pair, index) {
        this.calls++;
        pair[1].score += this.step;
        return [pair[0], pair[1].score, index, this === receiver, arguments.length];
      }, receiver, { wrong: true });
      return { result, original, receiver,
        alias: entries[0][1] === original.first };
    `
  },
  {
    name: "preserves published Object.fromEntries iterables within receiver callbacks",
    source: `
      const entries = [["first", 2], ["second", 3]];
      const receiver = { scale: 4 };
      return entries.map(function (entry) {
        const total = entries.reduce((sum, pair) => sum + pair[1], 0);
        return Object.fromEntries(new Map([[entry[0], entry[1] * this.scale],
          ["total", total], ["same", this === receiver]]));
      }, receiver);
    `
  },
  {
    name: "retains array own properties while nested callbacks use another receiver",
    source: `
      const values = [2, 3];
      values.label = "array";
      values["01"] = 7;
      values.read = function () { return this.label; };
      const receiver = { label: "receiver" };
      const result = values.map(function (left) {
        const same = this === receiver;
        return values.map(function (right) {
          return [left + right, same, this.label, values.read(), values["01"]];
        }, receiver);
      }, receiver);
      return { result, own: Object.hasOwn(values, "read") };
    `
  },
  {
    name: "preserves AW thrown receiver identity and releases nested array readers",
    source: `
      const values = [2, 3];
      const receiver = { marker: "source", visits: 0 };
      let caught;
      try {
        values.map(function () {
          return values.map(function () { this.visits++; throw this; }, receiver);
        }, receiver);
      } catch (error) { caught = [error === receiver, error.marker]; }
      values.push(4);
      return { caught, receiver, values };
    `
  },
  ...[
    ["Map", 'new Map([["first", 2], ["second", 3]])'],
    ["Set", "new Set([2, 3])"]
  ].map(([name, input]) => ({
    name: `preserves AW source throws and receiver arity in ${name}.forEach`,
    source: `
      const collection = ${input};
      const receiver = { calls: 0 };
      const trace = [];
      function visit(value, key, source) {
        this.calls++;
        trace.push([value, key, source === collection, visit.length, this === receiver]);
        throw this;
      }
      let same;
      try { collection.forEach(visit, receiver); }
      catch (error) { same = error === receiver; }
      collection.clear();
      return { trace, receiver, same, size: collection.size };
    `
  })),
  {
    name: "keeps Array.from receiver throws source-owned under AW",
    source: `
      const receiver = { marker: "mapper", calls: 0 };
      let caught;
      try {
        Array.from([2, 3], function () { this.calls++; throw this; }, receiver);
      } catch (error) { caught = [error === receiver, error.marker]; }
      return { caught, receiver };
    `
  }
];

describe("CTX-001 LANG/AW ordered integration", () => {
  it.each(cases)("$name", async ({ source }) => {
    const expected = Function('"use strict";\n' + source)();
    const current = await run(source);
    expect(current.ok).toBe(true);
    if (!current.ok) throw current.error;
    expect(structuredClone(current.returnValue)).toStrictEqual(expected);
    const replay = await run(source, {
      snapshot: JSON.parse(serializeSafeJSSnapshot(current.snapshot))
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw replay.error;
    expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
  });

  it("restores nested aliased callback receivers across an active checkpoint", async () => {
    const source = `
      const values = [2, 3];
      const alias = values;
      const outer = { calls: 0 };
      const inner = { bias: 1, calls: 0 };
      const rows = values.map(function (left) {
        this.calls++;
        return alias.map(function (right) {
          this.calls++;
          const receiver = this;
          return (async () => {
            await wait();
            return [left * right + this.bias, this === receiver, this === inner];
          })();
        }, inner);
      }, outer);
      const results = [];
      for (const row of rows) results.push(await Promise.all(row));
      values.push(4);
      return { results, outer, inner, values, same: alias === values };
    `;
    const expected = await Function(
      "wait",
      '"use strict"; return (async () => {' + source + "})();"
    )(async () => undefined);
    let release!: (value: undefined) => void;
    const pending = new Promise<undefined>((resolve) => {
      release = resolve;
    });
    const execution = run(source, {
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
      checkpoint = JSON.parse(await dump(execution));
    } finally {
      release(undefined);
    }
    const current = await execution;
    expect(current.ok).toBe(true);
    if (!current.ok) throw current.error;
    expect(structuredClone(current.returnValue)).toStrictEqual(expected);
    expect(checkpoint.pendingAwaits.length).toBeGreaterThan(0);
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
    expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
  });
});
