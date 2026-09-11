import { Script, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { parseModule } from "../parse/parser.js";
import { lint } from "../lint/index.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

describe("object method home objects", () => {
  it.each([
    [
      "ordinary method control",
      "const o={value:7,read(){return this.value}};await wait();return o.read();",
      7
    ],
    [
      "home alias after resume",
      "const o={read(){return super.x}};const read=o.read;await wait();Object.setPrototypeOf(o,{x:7});return read();",
      7
    ],
    [
      "async method home",
      "const o={async read(){await wait();return super.toString()}};return await o.read();",
      "[object Object]"
    ]
  ] as const)("preserves %s through a checkpoint", async (_name, source, expected) => {
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
    expect(await original).toMatchObject({ ok: true, returnValue: expected });
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
    ).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    ["data read", "const o={__proto__:{x:7},read(){return super.x}};return o.read();"],
    [
      "method receiver",
      "const base={read(){return this.x}};const o={__proto__:base,x:7,read(){return super.read()}};return o.read();"
    ],
    [
      "borrowed receiver",
      "const o={__proto__:{read(){return this.x}},read(){return super.read()}};return o.read.call({x:7});"
    ],
    [
      "home differs from receiver",
      "const o={__proto__:{x:7},read(){return super.x}};const other={__proto__:{x:9},read:o.read};return other.read();"
    ],
    [
      "live home prototype",
      "const o={__proto__:{x:7},read(){return super.x}};const read=o.read;Object.setPrototypeOf(o,{x:8});return read();"
    ],
    ["computed read", 'const o={__proto__:{x:7},read(key){return super[key]}};return o.read("x");'],
    [
      "computed method name",
      'const o={__proto__:{x:7},["read"](){return super.x}};return o.read();'
    ],
    ["literal method name", 'const o={__proto__:{x:7},"read"(){return super.x}};return o.read();'],
    ["numeric method name", "const o={__proto__:{x:7},1(){return super.x}};return o[1]();"],
    [
      "super data assignment",
      'const base={x:1};const o={__proto__:base,write(v){super.x=v}};o.write(7);return [o.x,base.x,Object.hasOwn(o,"x")];'
    ],
    [
      "borrowed super assignment",
      'const base={x:1};const o={__proto__:base,write(v){super.x=v}};const other={};o.write.call(other,7);return [other.x,base.x,Object.hasOwn(o,"x")];'
    ],
    [
      "getter receiver",
      'const base={};Object.defineProperty(base,"x",{get(){return this.base}});const o={__proto__:base,base:7,read(){return super.x}};return o.read();'
    ],
    [
      "setter receiver",
      'const base={};Object.defineProperty(base,"x",{set(v){this.base=v}});const o={__proto__:base,write(v){super.x=v}};o.write(7);return o.base;'
    ],
    [
      "super update",
      "const base={x:6};const o={__proto__:base,update(){return super.x++}};return [o.update(),o.x,base.x];"
    ],
    [
      "arrow inherits home",
      "const o={__proto__:{x:7},read(){return (()=>super.x)()}};return o.read();"
    ],
    [
      "escaped arrow inherits home",
      "const o={__proto__:{x:7},read(){return ()=>super.x}};const read=o.read();Object.setPrototypeOf(o,{x:8});return read();"
    ],
    [
      "parameter arrow inherits home",
      "const o={__proto__:{x:7},read(fn=()=>super.x){return fn()}};return o.read();"
    ],
    [
      "async method",
      "const o={__proto__:{x:7},async read(){await 0;return super.x}};return await o.read();"
    ],
    [
      "async arrow",
      "const o={__proto__:{x:7},read(){return async()=>{await 0;return super.x}}};return await o.read()();"
    ],
    [
      "getter throws identity",
      'const error={x:7};const base={};Object.defineProperty(base,"x",{get(){throw error}});const o={__proto__:base,read(){return super.x}};try{o.read()}catch(e){return e===error}'
    ],
    [
      "null home prototype",
      "const o={__proto__:null,read(){return super.x}};try{o.read()}catch(e){return e.name}"
    ],
    [
      "strict detached call",
      "const base={read(){return this}};const o={__proto__:base,read(){return super.read()}};const read=o.read;return read();"
    ],
    ["ordinary method control", "const o={x:7,read(){return this.x}};return o.read();"],
    ["method new.target control", "const o={read(){return new.target}};return o.read();"],
    [
      "method construction control",
      "const o={read(){return 7}};try{new o.read()}catch(e){return e.name}"
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "const o={read(){super()}};",
    "const o={read(){return function(){return super.x}}};",
    "const o={read(){return super}};",
    "const o={read(){return super?.x}};",
    "const o={read:function(){return super.x}};",
    "const o={read:()=>super.x};"
  ])("keeps native super early errors: %s", (source) => {
    expect(() => new Script(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  });

  it("admits object method super through lint", () => {
    expect(lint("const o={__proto__:{x:7},read(){return super.x}};return o.read();")).toEqual([]);
  });

  it("retains the home object of an escaped method and releases it on realm close", async () => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      expect(
        await realm.evaluate(
          'const read=(()=>{const o={__proto__:{payload:"x".repeat(700)},read(){return super.payload.length}};return o.read})();'
        )
      ).toMatchObject({ ok: true });
      expect(budget.currentDataSize).toBeGreaterThanOrEqual(700);
      expect(await realm.evaluate("return read();")).toMatchObject({ ok: true, returnValue: 700 });
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
