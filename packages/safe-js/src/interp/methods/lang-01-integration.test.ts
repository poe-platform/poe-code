import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

const cases: { name: string; source: string; replay?: boolean }[] = [
  {
    name: "keeps published own metadata during nested reads",
    source: `
      const values = [2, 3];
      values.label = "kept";
      values["01"] = 9;
      const result = values.map(left => values.map(right => {
        return [left * right, values.label, values["01"], Object.hasOwn(values, "label")];
      }));
      return { result, values: values.slice(), keys: Object.keys(values) };
    `
  },
  {
    name: "honors an own method while a captured builtin performs nested reads",
    replay: false,
    source: `
      const values = [2, 3];
      const read = values.map;
      values.label = "own";
      values.map = function () { return this.label; };
      const result = read.call(values, value => {
        return [value, values.reduce((sum, next) => sum + next, 0), values.map()];
      });
      return { result, label: values.label, owns: Object.hasOwn(values, "map") };
    `
  },
  ...["undefined", "0", "null"].map((shadow) => ({
    name: `preserves own ${shadow} method shadowing and argument evaluation order`,
    replay: false,
    source: `
      const values = [2, 3];
      const trace = [];
      values.map = ${shadow};
      values.forEach(value => {
        trace.push(values.reduce((sum, next) => sum + next, value));
        try { values.map(trace.push("argument")); }
        catch (error) { trace.push(error.name); }
      });
      return { trace, own: Object.hasOwn(values, "map"), shadow: values.map };
    `
  })),
  {
    name: "preserves published Object.fromEntries iterables within nested reads",
    source: `
      const pairs = [["first", 2], ["second", 3]];
      return pairs.map(pair => {
        const total = pairs.reduce((sum, next) => sum + next[1], 0);
        return Object.fromEntries(new Map([[pair[0], pair[1]], ["total", total]]));
      });
    `
  },
  {
    name: "preserves regex match array metadata through nested reads",
    source: `
      const input = "ab abab";
      const matches = Array.from(input.matchAll(/(ab)/g));
      return matches.map(left => matches.map(right => {
        return [left.index, right.index, left.input, right.input, left[1], right[1]];
      }));
    `
  },
  {
    name: "preserves published source arity during nested reads and replay",
    source: `
      const values = [2, 3];
      function combine(left, right) { return left + right; }
      function visit(value) {
        return values.map(next => [combine(value, next), combine.length, visit.length]);
      }
      return values.map(visit);
    `
  }
];

describe("LANG-01 ordered integration", () => {
  it.each(cases)("$name", async ({ source, replay: checkReplay = true }) => {
    const expected = Function('"use strict";\n' + source)();
    const current = await run(source);
    expect(current.ok).toBe(true);
    if (!current.ok) throw current.error;
    expect(structuredClone(current.returnValue)).toStrictEqual(expected);
    if (!checkReplay) return;
    const replay = await run(source, {
      snapshot: JSON.parse(serializeSafeJSSnapshot(current.snapshot))
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw replay.error;
    expect(structuredClone(replay.returnValue)).toStrictEqual(expected);
  });
});
