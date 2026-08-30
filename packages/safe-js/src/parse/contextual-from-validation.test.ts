import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { parse, parseModule } from "./parser.js";
import { tokenize } from "./tokenizer.js";

const ordinaryPrograms: [string, string, unknown][] = [
  [
    "nested scope and closure",
    "const from = 7; function make(from) { return () => ({ from }); } const read = make(3); return [from, read()];",
    [7, { from: 3 }]
  ],
  [
    "recursive named function",
    "function from(count) { return count === 0 ? 1 : count * from(count - 1); } return from(4);",
    24
  ],
  [
    "nested destructuring defaults",
    "const { row: { from = 5 } = {} } = {}; return { from };",
    { from: 5 }
  ],
  [
    "destructured function parameter",
    "function read({ from = 6 }) { return from; } return [read({}), read({ from: 9 })];",
    [6, 9]
  ],
  [
    "array assignment and rest",
    "let from; let rest; [from, ...rest] = [3, 4, 5]; return { from, rest };",
    { from: 3, rest: [4, 5] }
  ],
  [
    "for-of destructuring and shorthand",
    "const rows = []; for (const { from } of [{ from: 2 }, { from: 4 }]) rows.push({ from }); return rows;",
    [{ from: 2 }, { from: 4 }]
  ],
  [
    "catch binding shadows outer binding",
    "const from = 8; let caught; try { throw 3; } catch (from) { caught = { from }; } return [from, caught];",
    [8, { from: 3 }]
  ],
  [
    "method parameter and receiver",
    "const row = { value: 4, from(from) { return this.value + from; } }; return row.from(3);",
    7
  ],
  [
    "member assignment and optional access",
    "const row = { from: 2 }; row.from += 3; return [row.from, row?.from, row['from']];",
    [5, 5, 5]
  ],
  [
    "computed method and shorthand agree",
    "const from = 'from'; const row = { [from](value) { return { from, value }; } }; return row.from(2);",
    { from: "from", value: 2 }
  ],
  [
    "escaped binding and ordinary member",
    "const fr\\u006fm = 12; return { from, ['from']: from / 3 };",
    { from: 4 }
  ],
  ["codepoint-escaped method key", "return { fr\\u{6f}m(from) { return from / 2; } }.from(10);", 5],
  ["division separated by comments", "const from = 36; return from /* dividend */ / 3 / 4;", 3],
  [
    "template interpolation division",
    "const from = 18; return `from=${from / 3},nested=${`${from / 2}`}`;",
    "from=6,nested=9"
  ],
  [
    "conditional regex and division",
    "const from = 12; return [from / 2, /from/.test('from'), from ? from / 3 : 0];",
    [6, true, 4]
  ],
  [
    "object spreading and destructuring alias",
    "const from = 2; const row = { ...{ from }, other: 4 }; const { from: value, ...rest } = row; return [value, rest];",
    [2, { other: 4 }]
  ]
];

const validImports: [string, unknown][] = [
  ['import from from "fixture"; return from;', 11],
  ['import * as from from "fixture"; return from.value;', 13],
  ['import { from } from "fixture"; return { from };', { from: 17 }],
  ['import { value as from } from "fixture"; return from;', 13],
  ['import { from as value } from "fixture"; return value;', 17],
  ['import { from as from, value, } from "fixture"; return [from, value];', [17, 13]],
  ['import fr\\u006fm from "fixture"; return from;', 11],
  ['import { value as fr\\u{6f}m } from "fixture"; return from;', 13],
  ['import from /* separator */ from /* source */ "fixture"; return from;', 11],
  ['import { from }\nfrom\n"fixture"; return from;', 17]
];

const malformedImports = [
  'import from "fixture";',
  'import * as from "fixture";',
  'import { from } "fixture";',
  'import { value as from } "fixture";',
  'import from From "fixture";',
  'import from fromm "fixture";',
  'import from as "fixture";',
  'import from "from" "fixture";',
  'import from .from "fixture";',
  'import from (from) "fixture";',
  'import from /* from */ "fixture";',
  "import from from from;",
  "import from from 12;",
  "import from from `fixture`;",
  "import from from;",
  'import from from from "fixture";',
  'import { value as return } from "fixture";',
  'import * as return from "fixture";'
];

describe("TREE-01 independent contextual-from validation", () => {
  it.each(ordinaryPrograms)(
    "executes %s with complete native parity",
    async (_name, source, expected) => {
      const native = runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 });
      expect(native).toEqual(expected);

      const result = await run(source, {
        modules: {},
        budget: new Budget({ maxSteps: 5_000, maxCallDepth: 32 })
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toEqual(native);
    }
  );

  it.each(validImports)("resolves only in-memory imports: %s", async (source, expected) => {
    expect(parseModule(source).body[0]).toMatchObject({
      type: "ImportDeclaration",
      source: { type: "StringLiteral", value: "fixture" }
    });

    const result = await run(source, {
      modules: { fixture: { default: 11, value: 13, from: 17 } },
      budget: new Budget({ maxSteps: 500 })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(expected);
  });

  it.each(malformedImports)("requires a real import separator and source: %s", (source) => {
    expect(() => parseModule(source)).toThrow();
  });

  it.each([
    'import value fr\\u006fm "fixture";',
    'import value \\u0066rom "fixture";',
    'import value fr\\u{6f}m "fixture";',
    'import { value } fr\\u006fm "fixture";',
    'import * as value fr\\u006fm "fixture";'
  ])("rejects escapes in the contextual separator, not in bindings: %s", (source) => {
    expect(() => parseModule(source)).toThrow();
  });

  it.each(["return", "if", "for", "while", "throw", "try", "const", "import"])(
    "does not relax reserved binding %s",
    (keyword) => {
      expect(tokenize(keyword)[0].type).toBe("keyword");
      expect(() => parse(`const ${keyword} = 2;`)).toThrow();
      expect(() =>
        runInNewContext(`(function () { const ${keyword} = 2; })`, {}, { timeout: 1_000 })
      ).toThrow();
    }
  );

  it("keeps from lexically ordinary while preserving import/as tokens", () => {
    const source = 'import * as from from "fixture"; from / 2;';
    expect(tokenize(source).map(({ type, value }) => [type, value])).toEqual([
      ["keyword", "import"],
      ["punctuator", "*"],
      ["keyword", "as"],
      ["identifier", "from"],
      ["identifier", "from"],
      ["string", '"fixture"'],
      ["punctuator", ";"],
      ["identifier", "from"],
      ["punctuator", "/"],
      ["numeric", "2"],
      ["punctuator", ";"],
      ["eof", ""]
    ]);
  });

  it("accepts the separately repaired IP-002 return method", async () => {
    const source = "return { return() { return 7; } }.return();";
    expect(runInNewContext(`(function () { ${source} })()`, {}, { timeout: 1_000 })).toBe(7);
    expect(() => parse(source)).not.toThrow();
    await expect(
      run(source, { modules: {}, budget: new Budget({ maxSteps: 100 }) })
    ).resolves.toMatchObject({ ok: true, returnValue: 7 });
  });
});
