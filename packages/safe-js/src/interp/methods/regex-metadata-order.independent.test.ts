import { assert, describe, expect, it } from "vitest";
import { run } from "../../run.js";

const flags = ["", "i", "m", "s", "im", "is", "ms", "ims"];
const operations = flags.flatMap((flag) => [
  { method: "exec", flags: flag },
  { method: "exec", flags: `g${flag}` },
  { method: "match", flags: flag },
  { method: "matchAll", flags: `g${flag}` }
]);
const fixtures = [
  { pattern: "(a)?(b)()", input: "🧪b ab Ab" },
  { pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)", input: "zabcdefghijkl" },
  { pattern: "(?:)", input: "🧪a" },
  { pattern: "^(a.)", input: "aX\nA\nab" }
];

function expression(method: string): string {
  if (method === "exec") return "[regex.exec(input)]";
  if (method === "match") return "[input.match(regex)]";
  return "[...input.matchAll(regex)]";
}

describe("independent regex metadata ordering", () => {
  it.each(
    fixtures.flatMap((fixture) => operations.map((operation) => ({ ...fixture, ...operation })))
  )(
    "$method /$pattern/$flags preserves native keys, numeric indices and own undefined",
    async ({ pattern, input, method, flags }) => {
      const setup = `
        const input = ${JSON.stringify(input)};
        const regex = new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)});
        const matches = ${expression(method)};
      `;
      const source = `${setup} return matches;`;
      const expected = new Function(source)() as RegExpMatchArray[];
      expect(expected.length).toBeGreaterThan(0);
      const actual = await run(source);
      assert(actual.ok);
      assert(Array.isArray(actual.returnValue));
      expect(actual.returnValue.length).toBe(expected.length);
      for (const [position, native] of expected.entries()) {
        assert(native !== null);
        const match = actual.returnValue[position];
        assert(Array.isArray(match));
        const keys = [
          ...Array.from({ length: native.length }, (_, index) => String(index)),
          "index",
          "input",
          "groups"
        ];
        expect(Object.keys(native)).toStrictEqual(keys);
        expect(Object.keys(match)).toStrictEqual(keys);
        expect(Reflect.ownKeys(match)).toStrictEqual(Reflect.ownKeys(native));
        expect(Object.entries(match)).toStrictEqual(Object.entries(native));
        expect(match.length).toBe(native.length);
        expect(Object.hasOwn(match, "groups")).toBe(true);
        expect(Object.getOwnPropertyDescriptor(match, "groups")?.value).toBeUndefined();
        for (let index = 0; index < native.length; index += 1) {
          expect(Object.hasOwn(match, index)).toBe(true);
          expect(match[index]).toBe(native[index]);
        }
      }

      const reflectionSource = `${setup}
        return matches.map(match => ({
          keys: Object.keys(match),
          entries: Object.entries(match),
          values: Object.values(match),
          ownIndex: Object.hasOwn(match, "index"),
          ownInput: Object.hasOwn(match, "input"),
          ownGroups: Object.hasOwn(match, "groups"),
          elements: [...match]
        }));
      `;
      const nativeReflection = new Function(reflectionSource)();
      const reflected = await run(reflectionSource);
      assert(reflected.ok);
      expect(structuredClone(reflected.returnValue)).toStrictEqual(nativeReflection);
    }
  );

  it.each(operations)("$method /z/$flags produces no match metadata", async ({ method, flags }) => {
    const source = `
      const input = "ab";
      const regex = new RegExp("z", ${JSON.stringify(flags)});
      return ${expression(method)};
    `;
    const expected = new Function(source)();
    const actual = await run(source);
    assert(actual.ok);
    expect(actual.returnValue).toStrictEqual(expected);
  });

  it.each(flags)("global match /a/g%s keeps only numeric collection keys", async (flag) => {
    const source = `
      const matches = "aAa".match(new RegExp("a", ${JSON.stringify(`g${flag}`)}));
      return {
        keys: Object.keys(matches),
        entries: Object.entries(matches),
        ownIndex: Object.hasOwn(matches, "index"),
        ownInput: Object.hasOwn(matches, "input"),
        ownGroups: Object.hasOwn(matches, "groups")
      };
    `;
    const expected = new Function(source)();
    const actual = await run(source);
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });

  it("distinguishes an own undefined capture and groups from a hole and an empty capture", async () => {
    const source = `
      const match = /(a)?(b)()/.exec("b");
      const hole = new Array(1);
      return {
        optional: [Object.hasOwn(match, "1"), match[1]],
        empty: [Object.hasOwn(match, "3"), match[3]],
        groups: [Object.hasOwn(match, "groups"), Object.values(match).slice(-1)[0]],
        hole: [Object.hasOwn(hole, "0"), hole[0]]
      };
    `;
    const expected = new Function(source)();
    expect(expected).toStrictEqual({
      optional: [true, undefined],
      empty: [true, ""],
      groups: [true, undefined],
      hole: [false, undefined]
    });
    const actual = await run(source);
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });
});
