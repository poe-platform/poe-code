import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("RegExp string conversion", () => {
  it("bounds recursive source conversion", async () => {
    const source = "const regex=/a/;Object.defineProperty(regex,'source',{value:regex});return String(regex);";
    await expect(run(source, { budget: new Budget({ maxCallDepth: 20 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  });

  it.each([
    "return /a/g.toString();",
    "return /a/.toString.call({source:'b',flags:'i'});",
    "return /a/.toString.call({});",
    "const target=()=>0;target.source='b';target.flags='i';return /a/.toString.call(target);",
    "const log=[];const regex=/a/g;Object.defineProperty(regex,'source',{get(){log.push('source');return 'b'}});Object.defineProperty(regex,'flags',{get(){log.push('flags');return 'i'}});return [String(regex),log];",
    "const log=[];const regex=/a/;Object.defineProperty(regex,'source',{value:{toString(){log.push('source');return 'b'}}});Object.defineProperty(regex,'flags',{value:{toString(){log.push('flags');return 'i'}}});return [String(regex),log];",
    "const log=[];const target={get source(){log.push('get source');return {toString(){log.push('coerce source');return 'b'}}},get flags(){log.push('get flags');return {toString(){log.push('coerce flags');return 'i'}}}};return [/a/.toString.call(target),log];",
    "const log=[];const target={source:{toString(){throw 'source'}},get flags(){log.push('flags');return 'i'}};try{/a/.toString.call(target)}catch(error){return [error,log]}",
    "try{return /a/.toString.call({source:Symbol('s'),flags:'i'})}catch(error){return error.name}",
    "const regex=/a/g;regex.lastIndex={valueOf(){throw 'cursor'}};return regex.toString();"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["null", "undefined", "1", "'text'", "true", "Symbol('s')"])("rejects primitive receiver %s", async receiver => {
    const source = `try{return /a/.toString.call(${receiver})}catch(error){return error.name}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){" + source + "})()") });
  });

  it("retains converted source while evaluating flags", async () => {
    let calls = 0;
    let entered = 0;
    const source = "const regex=/a/;Object.defineProperty(regex,'source',{get(){return 'x'.repeat(4000)}});Object.defineProperty(regex,'flags',{get(){enter();const flags='y'.repeat(4000);check();return flags}});return String(regex);";
    await expect(run(source, { budget: new Budget({ dataSize: 7500 }), bindings: { enter: () => { entered++; }, check: () => { calls++; } } })).rejects.toMatchObject({ budget: "dataSize" });
    expect(entered).toBe(1);
    expect(calls).toBe(0);
  });

  it("allows a large source with bounded flags at the same budget", async () => {
    let calls = 0;
    const source = "const regex=/a/;Object.defineProperty(regex,'source',{get(){return 'x'.repeat(4000)}});Object.defineProperty(regex,'flags',{get(){check();return 'i'}});return String(regex).length;";
    expect(await run(source, { budget: new Budget({ dataSize: 7500 }), bindings: { check: () => { calls++; } } })).toMatchObject({ ok: true, returnValue: 4003 });
    expect(calls).toBe(1);
  });
});
