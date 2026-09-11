import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import * as parser from "./parser.js";
import { functionSources } from "./function-source.js";
import { Budget, SandboxError } from "../interp/budget.js";

const kinds = ["normal", "generator", "async", "async-generator"] as const;
const constructorSources = {
  normal: "Function",
  generator: "(function*(){}).constructor",
  async: "(async function(){}).constructor",
  "async-generator": "(async function*(){}).constructor"
};

it.each([
  {limits: {stringLength: 10}, budget: "stringLength"},
  {limits: {maxSteps: 10}, budget: "steps"}
])("preserves fatal $budget compilation errors", ({limits, budget: name}) => {
  const budget = new Budget(limits);
  const operation = budget.acquireCompileOwner(false);
  try {
    const compile = () => parser.parseDynamicFunction("normal", "a", "return a+1", operation.owner);
    expect(compile).toThrow(SandboxError);
    expect(compile).toThrow(expect.objectContaining({code: "budgetExceeded", budget: name}));
  } finally { operation.release(); }
});

it.each(kinds)("parses separately supplied source for %s functions", kind => {
  for (const [params, body] of [
    ["a,b=2,...rest", "return [a,b,rest]"],
    ["", "return /a+/i.test('A')"],
    ["a", "// trailing comment"],
    ["{a}={a:1}", "return a"],
    ["a/* comment */", "return function nested(){return a}"]
  ]) {
    const native = runInNewContext(`${constructorSources[kind]}(${JSON.stringify(params)},${JSON.stringify(body)}).toString()`);
    const node = parser.parseDynamicFunction(kind, params, body);
    expect(node.type).toBe("FunctionExpression");
    expect(node.async).toBe(kind === "async" || kind === "async-generator");
    expect(node.generator).toBe(kind === "generator" || kind === "async-generator");
    const range = functionSources.get(node)!;
    expect(range.text.slice(range.start, range.end)).toBe(native);
  }
});

it.each(kinds)("rejects parameter/body boundary injection for %s functions", kind => {
  for (const [params, body] of [
    ["/*", "*/ ) {"],
    ["a) {return 7} //", "return 2"],
    ["a", "} ; (function other(){"],
    ["a=`", "`"],
    ["a", "/*"],
    ["a=1", "'use strict';return a"],
    ["", "return super.x"],
    ["", "return import.meta"],
    ["", "return this.#secret"]
  ]) {
    expect(() => runInNewContext(`${constructorSources[kind]}(${JSON.stringify(params)},${JSON.stringify(body)})`)).toThrow();
    expect(() => parser.parseDynamicFunction(kind, params, body)).toThrow(SyntaxError);
  }
});

it("accepts duplicate simple parameters in non-strict function constructors", () => {
  for (const kind of kinds) {
    expect(() => runInNewContext(`${constructorSources[kind]}('a,a','return a')`)).not.toThrow();
    expect(() => parser.parseDynamicFunction(kind, "a,a", "return a")).not.toThrow();
    expect(() => runInNewContext(`${constructorSources[kind]}('a,a', '"use strict";return a')`)).toThrow();
    expect(() => parser.parseDynamicFunction(kind, "a,a", "'use strict';return a")).toThrow(SyntaxError);
  }
});

const contextualCases = [
    ["", "return await 1"],
    ["", "yield 1"],
    ["await", "return 1"],
    ["yield", "return 1"],
    ["a=await 1", "return a"],
    ["a=yield 1", "return a"],
    ["eval", "'use strict';return 1"],
    ["arguments", "'use strict';return 1"],
    ["", "'use strict';return function nested(a,a){return a}"],
    ["", "return function nested(a,a){return a}"],
    ["", "let a=1 let b=2"],
    ["", "let a=1\nlet b=2"],
    ["", "return 1 2"],
    ["", "return 1\n2"],
    ["", "if(true) 1 2"],
    ["", "'other';;'use strict';return function f(a,a){}"],
    ["", "return class C{m(){return function f(a,a){}}}"],
    ["", "return ()=>{'use strict';return function f(a,a){}}"],
    ["", "const f=()=>{'use strict'};return function g(a,a){}"],
    ["", "return async (await)=>1"],
    ["", "return ()=>await 1"],
    ["", "return async ()=>await 1"],
    ["", "'use strict';const eval=1"],
    ["", "'use strict';let arguments=1"],
    ["", "'use strict';var implements=1"]
];

it.each(kinds.flatMap(kind => contextualCases.map(([params, body]) => ({kind, params, body}))))(
  "matches contextual grammar for $kind ($params) {$body}", ({kind, params, body}) => {
    let valid = true;
    try { runInNewContext(`${constructorSources[kind]}(${JSON.stringify(params)},${JSON.stringify(body)})`); }
    catch { valid = false; }
    const compile = () => parser.parseDynamicFunction(kind, params, body);
    if (valid) expect(compile, `${kind}: ${params}; ${body}`).not.toThrow();
    else expect(compile, `${kind}: ${params}; ${body}`).toThrow(SyntaxError);
  }
);
