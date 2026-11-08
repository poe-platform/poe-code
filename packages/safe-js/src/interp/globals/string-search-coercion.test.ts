import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

for (const method of ["startsWith", "endsWith", "includes"]) {
  it.each([
    ["Symbol search", "Symbol('search')", "undefined"],
    ["RegExp search", "/a/", "undefined"],
    ["throwing search conversion", "{toString(){throw 'search'}}", "undefined"],
    ["throwing position conversion", "'a'", "{valueOf(){throw 'position'}}"],
    ["throwing match getter", "{get [Symbol.match](){throw 'match'}}", "undefined"],
    ["truthy match hook", "{[Symbol.match]:true,toString(){throw 'unreached'}}", "undefined"],
    ["RegExp with disabled match", "Object.assign(/a/,{[Symbol.match]:false})", "undefined"],
    ["function search conversion", "Object.assign(function(){},{toString(){return 'a'}})", "0"],
    ["ordered conversion", "{get [Symbol.match](){events.push('match');return false},toString(){events.push('search');return 'a'}}", "{valueOf(){events.push('position');return 1}}"],
    ["Symbol position", "''", "Symbol()"],
    ["BigInt position", "''", "1n"],
    ["negative infinity position", "'a'", "-Infinity"],
    ["positive infinity position", "''", "Infinity"],
    ["fractional position", "'b'", "1.9"],
    ["NaN position", "'a'", "NaN"],
    ["null match hook", "{[Symbol.match]:null,toString(){return 'a'}}", "0"],
    ["undefined RegExp match hook", "Object.assign(/a/,{[Symbol.match]:undefined})", "0"],
    ["object match hook", "{[Symbol.match]:{valueOf(){throw 'unreached'}},toString(){throw 'unreached'}}", "0"],
    ["primitive conversion hints", "{[Symbol.toPrimitive](hint){events.push(hint);return 'a'}}", "{[Symbol.toPrimitive](hint){events.push(hint);return 0}}"],
    ["Proxy search", "new Proxy({toString(){return 'a'}},{get(t,k,r){events.push(String(k));return Reflect.get(t,k,r)}})", "0"],
    ["ignored extra argument", "'a'", "0,()=>{throw 'unreached'}"],
  ])(`${method}: %s`, async (_name, search, position) => {
    const source = `const events=[];const receiver={toString(){events.push('receiver');return 'abc'}};
      let result;try{result=String.prototype.${method}.call(receiver,${search},${position})}
      catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
}

it.each(["pending", "completed"])("preserves search coercion through %s checkpoints", async mode => {
  const source = `const events=[];await 0;const search={get [Symbol.match](){events.push('match');return false},toString(){events.push('string');return 'b'}};
    const position={valueOf(){events.push('number');return 1}};
    return ['abc'.includes(search,position),events];`;
  const expected = await runInNewContext(`(async function(){"use strict";${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

it.each(["startsWith", "endsWith", "includes"] as const)("coerces direct %s arguments without an interpreter context", async method => {
  const events: string[] = [];
  const search = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => {
    events.push("search"); return "b";
  } }) };
  const position = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => {
    events.push("position"); return 1;
  } }) };
  expect(await callStringMethod("abc", method, [search, position], new Budget())).toBe("abc"[method]("b", 1));
  expect(events).toEqual(["search", "position"]);
});
