import { describe, expect, it } from "vitest";

import { run } from "./run.js";

describe("array own metadata", () => {
  it.each([
    {
      name: "reads stored bounds without losing ownership or enumeration",
      source: `
        const bin = [3, 4];
        bin.x0 = 2.5;
        bin["x1"] = 7.5;
        return {
          hasStart: Object.hasOwn(bin, "x0"),
          keys: Object.keys(bin),
          start: bin.x0,
          stop: bin["x1"],
          count: bin.length
        };
      `,
      expected: {
        hasStart: true,
        keys: ["0", "1", "x0", "x1"],
        start: 2.5,
        stop: 7.5,
        count: 2
      }
    },
    {
      name: "preserves metadata reference identity and updates",
      source: `
        const rows = [];
        const metadata = { count: 1 };
        rows.metadata = metadata;
        rows.metadata.count += 2;
        rows.total = 4;
        rows.total += 3;
        rows.total++;
        return [rows.metadata === metadata, metadata.count, rows.total];
      `,
      expected: [true, 3, 8]
    },
    {
      name: "distinguishes absent, undefined, and deleted own fields",
      source: `
        const rows = [];
        rows.note = undefined;
        rows.ready = false;
        rows.count = 0;
        rows.label = "";
        rows.empty = null;
        const before = [Object.hasOwn(rows, "note"), rows.note, rows.missing];
        delete rows.note;
        return [before, Object.hasOwn(rows, "note"), rows.ready, rows.count, rows.label, rows.empty];
      `,
      expected: [[true, undefined, undefined], false, false, 0, "", null]
    },
    {
      name: "keeps non-index numeric names separate from indices and length",
      source: `
        const rows = [10, 20];
        rows["01"] = "leading";
        rows[-1] = "negative";
        rows[1.5] = "fraction";
        rows[4294967295] = "boundary";
        rows.length = 1;
        rows.push(30);
        return [rows["01"], rows[-1], rows[1.5], rows[4294967295], rows.length, rows[1], rows.map(value => value * 2)];
      `,
      expected: ["leading", "negative", "fraction", "boundary", 2, 30, [20, 60]]
    },
    {
      name: "calls and extracts an own matcher used by matrix algorithms",
      source: `
        const matrix = [[1, 2], [3, 4]];
        matrix.match = (row, column) => matrix[row][column] === 4;
        const match = matrix.match;
        return [matrix.match(1, 1), match(0, 0), Object.hasOwn(matrix, "match")];
      `,
      expected: [true, false, true]
    },
    {
      name: "preserves the receiver when calling own array methods",
      source: `
        const rows = [2, 3];
        rows.match = function(value) { return this[0] + value; };
        rows.map = rows.match;
        return [rows.match(5), rows.map(6)];
      `,
      expected: [7, 8]
    },
    {
      name: "reads ordinary raw metadata while preserving tagged template raw strings",
      source: `
        const rows = [];
        rows.raw = "metadata";
        function tag(strings) { return [strings[0], strings.raw[0]]; }
        return [rows.raw, tag\`line\\nend\`];
      `,
      expected: ["metadata", ["line\nend", "line\\nend"]]
    },
    {
      name: "lets own callable methods shadow built-ins until deleted",
      source: `
        const rows = [2, 3];
        rows.map = value => value + 7;
        const map = rows.map;
        const direct = rows.map(5);
        const extracted = map(6);
        delete rows.map;
        return [direct, extracted, rows.map(value => value * 2)];
      `,
      expected: [12, 13, [4, 6]]
    },
    {
      name: "does not invoke a built-in hidden by an own non-callable field",
      source: `
        const rows = [2, 3];
        rows.map = undefined;
        let rejected = false;
        try { rows.map(value => value * 2); } catch (error) { rejected = error.name === "TypeError"; }
        return [Object.hasOwn(rows, "map"), rows.map === undefined, rejected, rows.map?.()];
      `,
      expected: [true, true, true, undefined]
    }
  ])("$name", async ({ source, expected }) => {
    const native = new Function(source)();
    expect(native).toEqual(expected);

    const result = await run(source, { modules: {} });
    expect(result).toMatchObject({ ok: true, returnValue: native });
  });

  it.each(["/a(b)/.exec(input)", "input.match(/a(b)/)", "Array.from(input.matchAll(/a(b)/g))[0]"])(
    "reads native match metadata from %s",
    async (expression) => {
      const source = `
      const input = "🧪ab";
      const match = ${expression};
      return {
        text: match[0], capture: match[1], index: match.index, input: match.input,
        hasIndex: Object.hasOwn(match, "index"), hasInput: Object.hasOwn(match, "input"),
        keys: Object.keys(match).sort()
      };
    `;
      const native = new Function(source)();
      expect(native).toEqual({
        text: "ab",
        capture: "b",
        index: 2,
        input: "🧪ab",
        hasIndex: true,
        hasInput: true,
        keys: ["0", "1", "groups", "index", "input"]
      });

      const result = await run(source, { modules: {} });
      expect(result).toMatchObject({ ok: true, returnValue: native });
    }
  );
});
