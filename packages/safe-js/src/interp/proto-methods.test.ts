import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

describe("__proto__ method definitions", () => {
  it("preserves an own __proto__ method through a checkpoint", async () => {
    const source =
      'const o={__proto__(){return 7}};await wait();return [Object.hasOwn(o,"__proto__"),o.__proto__()];';
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = run(source, {
      bindings: {
        wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
      }
    });
    let snapshot: ReturnType<typeof JSON.parse>;
    try {
      snapshot = JSON.parse(await dump(original));
    } finally {
      release();
      await original;
    }
    expect(await original).toMatchObject({ ok: true, returnValue: [true, 7] });
    expect(
      await run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve())
          })
        },
        snapshot: restore(snapshot, { source })
      })
    ).toMatchObject({ ok: true, returnValue: [true, 7] });
  });
  it.each([
    [
      "identifier method",
      'const o={__proto__(){return 7}};return [Object.hasOwn(o,"__proto__"),o.__proto__()];'
    ],
    ["quoted method", 'const o={"__proto__"(){return 7}};return o.__proto__();'],
    ["escaped identifier", String.raw`const o={__pr\u006fto__(){return 7}};return o.__proto__();`],
    ["async method", "const o={async __proto__(){return 7}};return await o.__proto__();"],
    ["quoted async method", 'const o={async "__proto__"(){return 7}};return await o.__proto__();'],
    [
      "method descriptor",
      'const o={__proto__(){return 7}};const d=Object.getOwnPropertyDescriptor(o,"__proto__");return [typeof d.value,d.writable,d.enumerable,d.configurable,d.value()];'
    ],
    [
      "method does not mutate prototype",
      "const o={__proto__(){return 7}};return Object.getPrototypeOf(o)===Object.getPrototypeOf({});"
    ],
    [
      "method followed by prototype",
      "const p={x:8};const o={__proto__(){return 7},__proto__:p};return [o.__proto__(),o.x,Object.getPrototypeOf(o)===p];"
    ],
    [
      "prototype followed by method",
      "const p={x:8};const o={__proto__:p,__proto__(){return 7}};return [o.__proto__(),o.x,Object.getPrototypeOf(o)===p];"
    ],
    [
      "null prototype method",
      "const o={__proto__:null,__proto__(){return 7}};return [o.__proto__(),Object.getPrototypeOf(o)===null];"
    ],
    [
      "duplicate methods",
      "const o={__proto__(){return 1},__proto__(){return 7}};return o.__proto__();"
    ],
    [
      "method super home",
      "const o={__proto__:{x:7},__proto__(){return super.x}};return o.__proto__();"
    ],
    ["borrowed receiver", "const o={__proto__(){return this.x}};return o.__proto__.call({x:7});"],
    [
      "spread preserves own method",
      'const o={__proto__(){return 7}};const copy={...o};return [Object.hasOwn(copy,"__proto__"),copy.__proto__(),Object.getPrototypeOf(copy)===Object.getPrototypeOf({})];'
    ],
    ["computed method control", 'const o={["__proto__"](){return 7}};return o.__proto__();'],
    [
      "computed async control",
      'const o={async ["__proto__"](){return 7}};return await o.__proto__();'
    ],
    ["shorthand control", "const __proto__=()=>7;const o={__proto__};return o.__proto__();"],
    [
      "function-valued prototype control",
      'const p=function(){};const o={__proto__:p};return [Object.getPrototypeOf(o)===p,Object.hasOwn(o,"__proto__")];'
    ],
    [
      "anonymous function-valued prototype control",
      'const o={__proto__:function(){return 7}};return [Object.hasOwn(o,"__proto__"),typeof Object.getPrototypeOf(o)];'
    ],
    [
      "primitive prototype control",
      'const o={__proto__:7};return [Object.hasOwn(o,"__proto__"),Object.getPrototypeOf(o)===Object.getPrototypeOf({})];'
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
