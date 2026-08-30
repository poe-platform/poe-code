import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { toMatchArray } from "./regex.js";

const matchCases = [
  { source: "a", input: "🧪ab" },
  { source: "a(b)", input: "🧪ab" },
  { source: "(a)?(b)", input: "🧪b" },
  { source: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)", input: "zabcdefghijk" },
  { source: "(?:)", input: "ab" }
];

describe("regex match metadata own-key order", () => {
  it.each(matchCases)("creates /$source/ results in native property order", ({ source, input }) => {
    const native = new RegExp(source).exec(input);
    if (native === null) throw new Error("The native fixture must match.");
    expect(Object.keys(native)).toEqual([
      ...Array.from({ length: native.length }, (_, index) => String(index)),
      "index",
      "input",
      "groups"
    ]);

    const actual = toMatchArray(
      { text: native[0], captures: native.slice(1), index: native.index },
      input
    );
    if (!Array.isArray(actual)) throw new Error("Expected a match array.");

    expect(Object.keys(actual)).toEqual(Object.keys(native));
    expect(Object.entries(actual)).toEqual(Object.entries(native));
    expect(Object.values(actual)).toEqual(Object.values(native));
    expect(actual.length).toBe(native.length);
    expect(Object.hasOwn(actual, "groups")).toBe(true);
    expect(actual).toMatchObject({ index: native.index, input, groups: undefined });
    for (let index = 0; index < native.length; index += 1) {
      expect(Object.hasOwn(actual, index)).toBe(true);
      expect(actual[index]).toBe(native[index]);
    }
  });

  const operationCases = matchCases.flatMap((matchCase) =>
    ["exec", "match", "matchAll"].map((method) => ({ ...matchCase, method }))
  );

  it.each(operationCases)(
    "$method /$source/ exposes native ordered keys, values, entries and presence",
    async ({ source, input, method }) => {
      const script = `
        const input = ${JSON.stringify(input)};
        const regex = new RegExp(${JSON.stringify(source)}, ${JSON.stringify(method === "matchAll" ? "g" : "")});
        const matches = ${method === "exec" ? "[regex.exec(input)]" : method === "match" ? "[input.match(regex)]" : "[...input.matchAll(regex)]"};
        return matches.map(match => ({
          keys: Object.keys(match),
          values: Object.values(match),
          entries: Object.entries(match),
          ownIndex: Object.hasOwn(match, "index"),
          ownInput: Object.hasOwn(match, "input"),
          ownGroups: Object.hasOwn(match, "groups"),
          ownLength: Object.hasOwn(match, "length"),
          ownFirstCapture: Object.hasOwn(match, "1"),
          length: match.length,
          elements: [...match]
        }));
      `;
      const expected = new Function(script)();
      await expect(run(script)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("restores all nine original key-order leaves without certifying pending named reads", async () => {
    const source = `const input = '🧪ab';
const matches = [/a(b)/.exec(input), input.match(/a(b)/), ...input.matchAll(/a(b)/g)];
return matches.map(match => ({ text: match[0], capture: match[1], index: String(match.index), input: String(match.input), keys: Object.keys(match) }));
`;
    const expected = Array.from({ length: 3 }, () => ({
      text: "ab",
      capture: "b",
      index: "2",
      input: "🧪ab",
      keys: ["0", "1", "index", "input", "groups"]
    }));
    expect(new Function(source)()).toEqual(expected);
    await expect(run(source)).resolves.toMatchObject({
      ok: true,
      returnValue: expected.map(({ keys }) => ({ keys }))
    });
  });

  it("does not create metadata for an unsuccessful match", () => {
    expect(/z/.exec("ab")).toBeNull();
    expect(toMatchArray(null, "ab")).toBeNull();
  });

  it("keeps global match collections free of per-match metadata", async () => {
    const source = `
      const matches = "aba".match(/a/g);
      return {
        keys: Object.keys(matches),
        values: Object.values(matches),
        ownIndex: Object.hasOwn(matches, "index"),
        ownInput: Object.hasOwn(matches, "input"),
        ownGroups: Object.hasOwn(matches, "groups")
      };
    `;
    const expected = new Function(source)();
    expect(expected).toEqual({
      keys: ["0", "1"],
      values: ["a", "a"],
      ownIndex: false,
      ownInput: false,
      ownGroups: false
    });
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });
});
