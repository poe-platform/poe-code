import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

for (const head of ["function", "function*", "async function", "async function*"]) {
  for (const name of ["await", "yield", "let", "eval", "arguments"]) {
    it.each(["", '"use strict";'])(`matches native ${head} ${name} with directive %s`, directive => {
      for (const expression of [true, false]) {
        const source = expression
          ? `return (${head} ${name}(){${directive}return 3})`
          : `${head} ${name}(){${directive}return 3}`;
        let valid = true;
        try { Function(source); } catch { valid = false; }
        if (valid) expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
        else expect(() => parseDynamicFunction("normal", "", source)).toThrow();
      }
    });
  }
}

it.each(["await", "yield", "let"])("executes a contextual named function %s", async name => {
  const source = `return (function ${name}(){return 3})()`;
  expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: Function(source)()});
});

it.each([
  "return function*(){return function yield(){}}",
  "return async function(){return function await(){}}"
])("resets expression name grammar: %s", source => {
  expect(() => Function(source)).not.toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
});
