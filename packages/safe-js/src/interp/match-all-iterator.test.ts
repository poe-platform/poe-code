import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

describe("matchAll iterator", () => {
  it.each([
    "const iterator='aba'.matchAll(/a/g);return [typeof iterator.next,Array.isArray(iterator),iterator[Symbol.iterator]()===iterator];",
    "const iterator='aba'.matchAll(/a/g);return [iterator.next().value.index,iterator.next().value.index,iterator.next(),iterator.next()];",
    "const iterator='aba'.matchAll(/a/g);const first=Array.from(iterator).map(value=>value.index);return [first,Array.from(iterator)];",
    "const regex=/a/g;regex.lastIndex=1;const iterator='aba'.matchAll(regex);regex.lastIndex=0;return [iterator.next().value.index,regex.lastIndex,iterator.next().done];",
    "const iterator='ab'.matchAll(/(?:)/g);return Array.from(iterator).map(value=>value.index);",
    "const iterator='aba'.matchAll('a');return [iterator.next().value.index,iterator.next().value.index,iterator.next().done];",
    "const iterator='aba'.matchAll(/a/g);return [Object.prototype.toString.call(iterator),Object.keys(iterator),typeof iterator.return];",
    "const regex=/a/;regex[Symbol.match]=false;const iterator='aba'.matchAll(regex);return [iterator.next().value.index,iterator.next().done];",
    "const iterator='a'.matchAll(/a/g);return ['next' in iterator,Symbol.iterator in iterator,Symbol.toStringTag in iterator,String(iterator)];",
    "const iterator='a'.matchAll(/a/g);try{iterator.next.call({})}catch(error){return error.name}",
    "const iterator='a'.matchAll(/a/g);try{structuredClone(iterator)}catch(error){return true}",
    "const iterator='aba'.matchAll(/a/g);iterator.next=()=>({done:true});return Array.from(iterator);"
  ])("matches native: %s", async (source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()", { structuredClone });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("resumes a partially consumed for-of iterator after a host suspension", async () => {
    const source = "const result=[];const iterator='ababa'.matchAll(/a/g);for(const match of iterator){result.push(match.index);if(match.index===0)await wait()}return [result,iterator.next().done];";
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const original = run(source, { bindings: {
      wait: createSandboxClosure({ async: true, call: () => { entered(); return createSandboxPromise(pending); } })
    } });
    let snapshot: ReturnType<typeof JSON.parse>;
    try {
      await ready;
      snapshot = JSON.parse(await dump(original));
    } finally { release(); await original; }
    expect(await original).toMatchObject({ ok: true, returnValue: [[0, 2, 4], true] });
    expect(await run(source, { snapshot: restore(snapshot, { source }), bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) })
    } })).toMatchObject({ ok: true, returnValue: [[0, 2, 4], true] });
  });
});
