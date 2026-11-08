import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each(["async", "of", "as", "await", "yield", "let"])("supports contextual label %s", async name => {
  const escaped = `\\u${name.charCodeAt(0).toString(16).padStart(4, "0")}${name.slice(1)}`;
  for (const spelling of [name, escaped]) {
    for (const source of [
      `${spelling}:{break ${spelling};}return 3`,
      `${spelling}:for(var i=0;i<2;i++){continue ${spelling};}return i`,
      `outer:${spelling}:for(var i=0;i<2;i++){continue ${spelling};}return i`
    ]) {
      const expected: unknown = Function(source)();
      expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
      expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
    }
  }
});

it.each([
  '"use strict";yield:{}',
  '"use strict";let:{}',
  'return async function(){await:{}}',
  'return function*(){yield:{}}',
  'async:async:{}',
  'async:{continue async;}',
  'async:{break of;}'
])("rejects invalid contextual label usage: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});

it.each(["implements", "interface", "package", "private", "protected", "public", "static"])("rejects strict reserved label %s", name => {
  const source = `"use strict";${name}:{}`;
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});

it.each([
  'var let=0;label:let=3;return let',
  '"use strict";eval:{break eval;}return 3',
  '"use strict";arguments:{break arguments;}return 3',
  'for(var i=0;i<1;i++){break\nasync:{}}return i'
])("executes valid label boundaries: %s", async source => {
  const expected: unknown = Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
});
