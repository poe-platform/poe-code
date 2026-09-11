import { Script, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { serializeSafeJSSnapshot } from "../snapshot/dump-format.js";
import { parse } from "./parser.js";
import { tokenize } from "./tokenizer.js";

const acceptedPrograms: [string, string, unknown][] = [
  [
    "return method with destructuring, rest, and receiver",
    "const object = { value: 4, return({ from = 2 } = {}, ...rest) { return [this.value + from, rest]; } }; return object.return({}, 7, 8);",
    [6, [7, 8]]
  ],
  [
    "keyword methods sharing receiver state",
    "const object = { value: 0, return(value) { this.value += value; return this.value; }, throw(value) { return this.return(value); } }; return [object.throw(2), object.return(3), object.value];",
    [2, 5, 5]
  ],
  [
    "escaped keyword and codepoint method names",
    "const object = { ret\\u0075rn() { return 2; }, \\u{74}hrow() { return 3; } }; return [object.return(), object.throw()];",
    [2, 3]
  ],
  [
    "method-name line breaks are not async-modifier line breaks",
    "const object = { return\n(value) { return value; }, async\n() { return 3; } }; return [object.return(2), object.async()];",
    [2, 3]
  ],
  [
    "ordinary get, set, and async names are methods",
    "const object = { get(value) { return value + 1; }, set(value) { return value + 2; }, as\\u0079nc(value) { return value + 3; } }; return [object.get(1), object.set(1), object.async(1)];",
    [2, 3, 4]
  ],
  [
    "keyword methods do not reserve sibling local names",
    "const from = 12; const async = 5; const object = { from, async, return() { return this.from / 3 + this.async; } }; return object.return();",
    9
  ],
  [
    "async keyword method with escaped name",
    "const object = { value: 3, async ret\\u0075rn(value) { return await Promise.resolve(this.value + value); } }; return await object.return(4);",
    7
  ],
  [
    "async keyword names are distinct from modifiers",
    "return await { async async(value) { return await Promise.resolve(value); } }.async(7);",
    7
  ],
  [
    "async get and set names are not accessors",
    "const object = { async get(value) { return value + 1; }, async set(value) { return value + 2; } }; return [await object.get(2), await object.set(2)];",
    [3, 4]
  ],
  [
    "async computed key evaluated once before calls",
    "const trace = []; const object = { value: 4, async [(trace.push('key'), 'return')](amount) { trace.push('call'); return await Promise.resolve(this.value + amount); } }; const before = trace.slice(); const value = await object.return(3); return { before, value, trace };",
    { before: ["key"], value: 7, trace: ["key", "call"] }
  ],
  [
    "nested computed key with bracket characters in literal",
    "const names = { ']': ['return'] }; const object = { async [names[']'][0]]() { return 7; } }; return await object.return();",
    7
  ],
  [
    "computed template key and receiver",
    "const object = { value: 7, async [`ret${'urn'}`]() { return this.value; } }; return await object.return();",
    7
  ],
  [
    "comments inside async modifier separation",
    "return await { async /* same line */ return() { return 7; } }.return();",
    7
  ],
  [
    "line break after async method name",
    "return await { async return\n() { return 7; } }.return();",
    7
  ],
  [
    "computed method key permits internal line breaks",
    "return await { async [\n'return'\n]() { return 7; } }.return();",
    7
  ],
  [
    "async literal-name methods keep await and receiver",
    "const object = { value: 3, async 'return'(value) { return await Promise.resolve(this.value + value); }, async 2() { return this.value; } }; return [await object.return(4), await object[2]()];",
    [7, 3]
  ],
  [
    "computed names get and set remain ordinary methods",
    "const object = { ['get'](value) { return value; }, async ['set'](value) { return value + 1; } }; return [object.get(2), await object.set(2)];",
    [2, 3]
  ]
];

const invalidPrograms = [
  "return { return };",
  "return { ret\\u0075rn };",
  "const return = 1;",
  "const ret\\u0075rn = 1;",
  "return { return(return) {} };",
  "return { return({ return }) {} };",
  "return { async return(return) {} };",
  "return { async ['return'](return) {} };",
  "return { async\nreturn() {} };",
  "return { async\rreturn() {} };",
  "return { async\r\n['return']() {} };",
  "return { async // comment\n['return']() {} };",
  "return { async /*\n*/ ['return']() {} };",
  "return { as\\u0079nc return() {} };",
  "return { \\u0061sync ['return']() {} };",
  "return { async ret\\u0075rn };",
  "return { async ['return']: 1 };",
  "return { async 'return': 1 };",
  "return { async 2: 1 };",
  "return { async ['return'] };",
  "return { async ['return']( {} };",
  "return { async get return() {} };",
  "return { async set ['return'](value) {} };"
];

const additionalMethodPrograms = [
  "return { get return() { return 1; } };",
  "return { set return(value) {} };",
  "return { get ['return']() { return 1; } };",
  "return { set ['return'](value) {} };",
  "return { get 'return'() { return 1; } };",
  "return { set 2(value) {} };",
  "return { *return() { yield 1; } };",
  "return { async *['return']() { yield 1; } };"
];

describe("IP-002 independent keyword and async-computed method validation", () => {
  it.each(additionalMethodPrograms)("accepts native-valid accessor or generator syntax: %s", (source) => {
    expect(() => new Script(`(async function () { ${source} })()`)).not.toThrow();
    expect(() => parse(source)).not.toThrow();
  });

  it.each(acceptedPrograms)(
    "matches native and completed replay: %s",
    async (_name, source, expected) => {
      const native = await runInNewContext(
        `(async function () { ${source} })()`,
        {},
        { timeout: 1_000 }
      );
      expect(native).toEqual(expected);

      const current = await run(source, {
        modules: {},
        budget: new Budget({ maxSteps: 5_000, maxCallDepth: 32 })
      });
      expect(current.ok).toBe(true);
      if (!current.ok) throw current.error;
      expect(current.returnValue).toEqual(native);

      const replay = await run(source, {
        modules: {},
        snapshot: JSON.parse(serializeSafeJSSnapshot(current.snapshot)),
        budget: new Budget({ maxSteps: 5_000, maxCallDepth: 32 })
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw replay.error;
      expect(replay.returnValue).toEqual(native);
    }
  );

  it.each(invalidPrograms)("rejects native-invalid method/binding syntax: %s", (source) => {
    expect(() => new Script(`(async function () { ${source} })()`)).toThrow();
    expect(() => parse(source)).toThrow();
  });


  it.each([
    ["return() {}", false, false],
    ["ret\\u0075rn() {}", false, false],
    ["async() {}", false, false],
    ["get() {}", false, false],
    ["set(value) {}", false, false],
    ["async return() {}", true, false],
    ["async get() {}", true, false],
    ["async ['return']() {}", true, true],
    ["async 'return'() {}", true, false],
    ["async 2() {}", true, false]
  ])("preserves method metadata for %s", (property, async, computed) => {
    expect(parse(`({ ${property} })`)).toMatchObject({
      type: "ObjectExpression",
      properties: [
        {
          type: "Property",
          computed,
          shorthand: false,
          value: { type: "FunctionExpression", method: true, async, generator: false }
        }
      ]
    });
  });

  it("keeps keyword token classification while accepting identifier property names", () => {
    expect(
      tokenize("return throw const import async")
        .slice(0, -1)
        .map((token) => token.type)
    ).toEqual(["keyword", "keyword", "keyword", "keyword", "keyword"]);
    expect(() => new Script("(function () { return { return: 1 }; })()")).not.toThrow();
    expect(parse("({ return: 1 })")).toMatchObject({
      type: "ObjectExpression",
      properties: [{ computed: false, shorthand: false, key: { type: "Identifier", name: "return" } }]
    });
    expect(() => parse("const return = 1;")).toThrow();
    expect(() => parse("return { return };")).toThrow();
  });
});
