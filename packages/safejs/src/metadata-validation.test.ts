import { describe, expect, it } from "vitest";

import { Budget } from "./interp/budget.js";
import { run } from "./run.js";

describe("independent array own metadata validation", () => {
  it.each(["undefined", "null", "false", "0", '""'])(
    "keeps own %s fields and rejects their invocation without falling back",
    async (literal) => {
      const source = `
        const rows = [4, 7];
        rows.map = ${literal};
        rows.metadata = ${literal};
        const trace = [];
        function argument() { trace.push("argument"); return 1; }
        try { rows.map(argument()); } catch (error) { trace.push(error.name); }
        try { rows.map?.(argument()); } catch (error) { trace.push(error.name); }
        const before = [Object.hasOwn(rows, "map"), rows.map, rows.metadata, trace];
        delete rows.map;
        return [before, rows.map(value => value + 1), Object.hasOwn(rows, "map")];
      `;
      const expectedTrace = ["argument", "TypeError"];
      if (literal !== "undefined" && literal !== "null") {
        expectedTrace.push("argument", "TypeError");
      }
      const native = new Function(`"use strict"; ${source}`)();
      expect(native[0][3]).toEqual(expectedTrace);
      expect(native[1]).toEqual([5, 8]);
      await expect(run(source, { modules: {} })).resolves.toMatchObject({
        ok: true,
        returnValue: native
      });
    }
  );

  it.each([
    {
      name: "evaluates computed own calls once in receiver-key-argument order",
      source: `
        const trace = [];
        const rows = [8];
        rows.find = function(value) { trace.push("call"); return this[0] + value; };
        function receiver() { trace.push("receiver"); return rows; }
        function key() { trace.push("key"); return "find"; }
        function argument() { trace.push("argument"); return 3; }
        const value = receiver()[key()](argument());
        return [value, trace];
      `,
      expected: [11, ["receiver", "key", "argument", "call"]]
    },
    {
      name: "preserves direct receivers and extracted callable identity",
      source: `
        const rows = [3, 9];
        rows.total = 4;
        rows.match = function(increment) { this.total += increment; return this.total; };
        rows.reduce = rows.match;
        const extracted = rows.reduce;
        const first = rows.match(2);
        const second = rows["reduce"](3);
        return [extracted === rows.match, first, second, rows.total];
      `,
      expected: [true, 6, 9, 9]
    },
    {
      name: "preserves live custom metadata aliases through array mutation",
      source: `
        const metadata = { count: 2 };
        const rows = [metadata];
        const alias = rows;
        rows.metadata = metadata;
        rows.raw = metadata;
        alias.metadata.count += 3;
        rows.unshift("prefix");
        rows.reverse();
        return [rows === alias, rows.metadata === metadata, rows.raw === rows[0],
          metadata.count, Object.keys(rows), rows.length];
      `,
      expected: [true, true, true, 5, ["0", "1", "metadata", "raw"], 2]
    },
    {
      name: "distinguishes ordinary raw callbacks from tagged-template raw",
      source: `
        const rows = [12];
        rows.raw = function() { return this[0]; };
        function tag(strings) { return [strings[0], strings.raw[0], strings.raw.length]; }
        return [rows.raw(), tag\`one\\ntwo\`];
      `,
      expected: [12, ["one\ntwo", "one\\ntwo", 1]]
    },
    {
      name: "shadows built-ins with registered native static callables",
      source: `
        const rows = [2, 5];
        rows.map = Array.isArray;
        rows.filter = Math.max;
        const extracted = rows.filter;
        const before = [rows.map(rows), rows.map(2), rows.filter(4, 9), extracted(3, 7)];
        delete rows.map;
        delete rows.filter;
        return [before, rows.map(value => value * 3), rows.filter(value => value > 3)];
      `,
      expected: [[true, false, 9, 7], [6, 15], [5]]
    },
    {
      name: "preserves noncanonical numeric metadata while length truncates indices",
      source: `
        const rows = [5, 8];
        rows["1e0"] = "exponent";
        rows["-0"] = "signed";
        rows["01"] = "leading";
        rows[4294967295] = "maximum";
        rows.length = 1;
        rows.push(6);
        return [rows["1e0"], rows["-0"], rows["01"], rows[4294967295], rows[0], rows[1], rows.length];
      `,
      expected: ["exponent", "signed", "leading", "maximum", 5, 6, 2]
    },
    {
      name: "keeps supported array methods intact with own metadata present",
      source: `
        const rows = [3, 1, 2];
        rows.label = "bins";
        rows.sort((left, right) => left - right);
        const sum = rows.reduce((total, value) => total + value, 0);
        const selected = rows.filter(value => value > 1);
        const removed = rows.splice(1, 1, 7);
        return [rows.join(":"), sum, selected, removed, rows.label];
      `,
      expected: ["1:7:3", 6, [2, 3], [2], "bins"]
    },
    {
      name: "reads assigned fields through destructuring and optional access",
      source: `
        const rows = Object.assign([], { count: 0, label: "", available: false });
        const { count, label, available } = rows;
        rows.count ||= 4;
        rows.label ??= "fallback";
        rows.available &&= true;
        return [count, label, available, rows?.count, rows.label, rows.available];
      `,
      expected: [0, "", false, 4, "", false]
    }
  ])("$name", async ({ source, expected }) => {
    const native = new Function(`"use strict"; ${source}`)();
    expect(native).toEqual(expected);
    const budget = new Budget({ maxSteps: 10_000, maxCallDepth: 24 });
    await expect(run(source, { modules: {}, budget })).resolves.toMatchObject({
      ok: true,
      returnValue: native
    });
  });

  it("preserves an own async method receiver across an ordinary await", async () => {
    const source = `
      const rows = [6];
      rows.map = async function(value) { await Promise.resolve(); return this[0] + value; };
      return await rows.map(4);
    `;
    const native = await new Function(`return (async () => { ${source} })();`)();
    expect(native).toBe(10);
    await expect(run(source, { modules: {} })).resolves.toMatchObject({
      ok: true,
      returnValue: native
    });
  });
});
