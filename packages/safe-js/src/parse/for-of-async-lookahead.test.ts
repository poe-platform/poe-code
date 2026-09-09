import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each([" ", "\n", " /* comment */ "])("rejects bare async before for-of with separator %j", separator => {
  const source = `var async;for(async${separator}of []){}`;
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});

it.each([
  'var async;for((async) of [3]){}return async',
  'var async;for(\\u0061sync of [3]){}return async',
  'var async={};for(async.x of [3]){}return async.x',
  'for(var async of [3]){}return async',
  'var async;for(async in {x:3}){}return async',
  'return (async function(){var async;for await(async of [3]){}return async})()'
])("preserves valid async loop targets: %s", async source => {
  const expected: unknown = await Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return await Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
});
