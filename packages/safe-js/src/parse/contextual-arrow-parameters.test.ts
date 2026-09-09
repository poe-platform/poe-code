import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each(["as", "of", "async", "yield", "let"])("accepts a non-strict async arrow parameter %s", async name => {
  const escaped = `\\u${name.charCodeAt(0).toString(16).padStart(4, "0")}${name.slice(1)}`;
  for (const spelling of [name, escaped]) {
    const source = `return (async ${spelling} => ${spelling}+1)(2)`;
    const expected: unknown = await Function(source)();
    expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
    expect(await run(`return await Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
  }
});

it.each(["await", "yield", "let"])("accepts a non-strict contextual arrow parameter %s", async name => {
  const escaped = `\\u${name.charCodeAt(0).toString(16).padStart(4, "0")}${name.slice(1)}`;
  for (const spelling of [name, escaped]) {
    const source = `return (${spelling} => ${spelling}+1)(2)`;
    const expected: unknown = Function(source)();
    expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
    expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
  }
});

it.each([
  '"use strict";return yield => 3',
  '"use strict";return let => 3',
  'return async await => 3',
  'return async \\u0061wait => 3',
  'return function*(){return async yield => 3}',
  '"use strict";return async let => 3',
  '"use strict";return async yield => 3',
  'return function*(){return yield => 3}',
  'return async function(){return await => 3}'
])("rejects a reserved arrow parameter: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});
