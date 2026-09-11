import { Script, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../core.js";
import { parseModule } from "../parse/parser.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";
import { lint } from "../lint/index.js";

describe("object generator methods", () => {
  it("admits supported generator methods through harness lint", () => {
    const source =
      'export default async () => { await Promise.resolve(); const o={*items(){yield 7},*["other"](){yield 8}}; return [...o.items(),...o.other()]; };';
    expect(lint(source).filter((item) => item.severity === "error")).toEqual([]);
  });

  it("restores a suspended method with its home object", async () => {
    const source =
      "const o={*items(){yield this.y;yield super.x},y:7};const it=o.items();const first=it.next();await wait();Object.setPrototypeOf(o,{x:8});return [first,it.next()];";
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
    const expected = {
      ok: true,
      returnValue: [
        { value: 7, done: false },
        { value: 8, done: false }
      ]
    };
    expect(await original).toMatchObject(expected);
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
    ).toMatchObject(expected);
  });

  it.each([
    ["ordinary", "const o={*items(){yield 7;yield 8}};return [...o.items()];"],
    ["computed", 'const o={*["items"](){yield 7}};return o.items().next().value;'],
    ["quoted", 'const o={*"items"(){yield 7}};return [...o.items()];'],
    ["numeric", "const o={*2(){yield 7}};return [...o[2]()];"],
    ["reserved", "const o={*return(){yield 7}};return [...o.return()];"],
    ["get name", "const o={*get(){yield 7}};return [...o.get()];"],
    ["async name", "const o={*async(){yield 7}};return [...o.async()];"],
    ["receiver", "const o={x:7,*items(){yield this.x}};return [...o.items()];"],
    ["borrowed receiver", "const o={*items(){yield this.x}};return [...o.items.call({x:7})];"],
    [
      "deferred body",
      "let n=0;const o={*items(){n++;yield n}};const it=o.items();const before=n;return [before,it.next(),n];"
    ],
    [
      "sent values",
      "const o={*items(){return yield 7}};const it=o.items();return [it.next(),it.next(8)];"
    ],
    ["delegation", "const o={*items(){yield* [7,8]}};return [...o.items()];"],
    ["super", "const o={__proto__:{x:7},*items(){yield super.x}};return [...o.items()];"],
    [
      "super call",
      "const o={__proto__:{read(){return this.x}},x:7,*items(){yield super.read()}};return [...o.items()];"
    ],
    [
      "home mutation",
      "const o={*items(){yield super.x}};const it=o.items();Object.setPrototypeOf(o,{x:7});return it.next();"
    ],
    [
      "return cleanup",
      "let cleaned=false;const o={*items(){try{yield 7}finally{cleaned=true}}};const it=o.items();it.next();return [it.return(8),cleaned];"
    ],
    [
      "throw",
      "const o={*items(){try{yield 7}catch(e){yield e}}};const it=o.items();it.next();return it.throw(8);"
    ],
    ["defaults", "const o={*items({x=7}={}){yield x}};return [...o.items()];"],
    ["arguments", "const o={*items(){yield arguments[0]}};return [...o.items(7)];"],
    ["source", "const o={*items() { yield 7; }};return o.items.toString();"],
    ["nonconstructible", "const o={*items(){yield 7}};try{new o.items()}catch(e){return e.name}"],
    [
      "proto name",
      'const o={*__proto__(){yield 7}};return [Object.hasOwn(o,"__proto__"),[...o.__proto__()]];'
    ],
    ["ordinary control", "const o={items(){return 7}};return o.items();"],
    ["generator expression control", "const o={items:function*(){yield 7}};return [...o.items()];"]
  ])("matches native %s", async (_name, source) => {
    const native = runInNewContext(`(function(){"use strict";${source}})()`, {}, { timeout: 1000 });
    const result = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5000 }) });
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(native);
  });

  it.each([
    "const o={*items:1};",
    "const o={*items};",
    "const o={*get x(){}};",
    "const o={*items(x=yield 1){}};",
    "const o={*items(){super()}};",
    "const o={*items(){function nested(){yield 1}}};"
  ])("rejects native-invalid syntax %s", (source) => {
    expect(() => new Script(`(function(){"use strict";${source}})()`)).toThrow();
    expect(() => parseModule(source)).toThrow();
  });
});
