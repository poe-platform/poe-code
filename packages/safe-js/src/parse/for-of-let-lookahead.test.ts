import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each(["normal", "async"] as const)("rejects an unescaped let member head in %s code", kind => {
  const source = `var let={};for${kind === "async" ? " await" : ""}(let.x of []){}`;
  const Constructor = kind === "async" ? Object.getPrototypeOf(async function(){}).constructor : Function;
  expect(() => Constructor(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction(kind, "", source)).toThrow();
});

it.each([
  "var let;for(\\u006cet of [1,2]){}return let",
  "var let={};for(\\u006cet.x of [1,2]){}return let.x",
  'var let={};for(\\u006cet["x"] of [1,2]){}return let.x',
  "var let;for((let) of [1,2]){}return let",
  "var let={};for(let.x in {a:1}){}return let.x",
  "const seen=[];for(let [x] of [[1],[2]])seen.push(x);return seen",
  "const seen=[];for(let of of [1,2])seen.push(of);return seen"
])("preserves contextual let distinctions: %s", async source => {
  const expected: unknown = Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return Function(${JSON.stringify(source)})()`))
    .toMatchObject({ok: true, returnValue: expected});
});
