import { Script, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { parseModule } from "../parse/parser.js";
import { lint } from "../lint/index.js";
import { AS003 } from "../lint/rules/AS003.js";
import { AS_UNBOUNDED_LOOP } from "../lint/rules/AS-unbounded-loop.js";
import { dump } from "../dump.js";
import { deepCopyToSandbox } from "./values.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { interpret } from "./interpreter.js";

describe("object literal accessors", () => {
  it.each([
    ["getter receiver", "const o={base:7,get x(){return this.base}};return o.x;"],
    ["setter receiver", "const o={set x(v){this.base=v}};o.x=7;return o.base;"],
    [
      "paired accessors",
      "const o={get x(){return this.base},set x(v){this.base=v}};o.x=7;return o.x;"
    ],
    [
      "reverse pair order",
      "const o={set x(v){this.base=v},get x(){return this.base}};o.x=7;return o.x;"
    ],
    [
      "computed pair and order",
      'const log=[];const o={get [(log.push("get"),"x")](){return this.base},set [(log.push("set"),"x")](v){this.base=v}};o.x=7;return [o.x,log];'
    ],
    [
      "quoted keys",
      'const o={get "x"(){return 7},set "y"(v){this.base=v}};o.y=8;return [o.x,o.base];'
    ],
    [
      "numeric keys",
      "const o={get 1(){return 7},set 2(v){this.base=v}};o[2]=8;return [o[1],o.base];"
    ],
    [
      "reserved keys",
      "const o={get return(){return 7},get null(){return 8}};return [o.return,o.null];"
    ],
    [
      "get/set names",
      "const o={get get(){return 7},set set(v){this.base=v}};o.set=8;return [o.get,o.base];"
    ],
    ["async property name", "const o={get async(){return 7}};return o.async;"],
    [
      "descriptor metadata",
      'const o={get x(){return 7},set x(v){}};const d=Object.getOwnPropertyDescriptor(o,"x");return [d.enumerable,d.configurable,d.get.name,d.set.name,d.get.length,d.set.length,Object.hasOwn(d,"value")];'
    ],
    [
      "getter source",
      'const o={get x() { return 7; }};return Object.getOwnPropertyDescriptor(o,"x").get.toString();'
    ],
    [
      "computed setter source",
      'const o={set ["x"](v) { this.base=v; }};return Object.getOwnPropertyDescriptor(o,"x").set.toString();'
    ],
    [
      "default setter",
      'const o={set x(v=7){this.base=v}};o.x=undefined;return [o.base,Object.getOwnPropertyDescriptor(o,"x").set.length];'
    ],
    ["destructured setter", "const o={set x({v=7}){this.base=v}};o.x={};return o.base;"],
    ["array setter", "const o={set x([v]){this.base=v}};o.x=[7];return o.base;"],
    [
      "getter-only assignment",
      "const o={get x(){return 7}};try{o.x=8}catch(e){return [e.name,o.x]}"
    ],
    ["setter-only read", "const o={set x(v){}};return o.x;"],
    [
      "duplicate getter preserves setter",
      "const o={get x(){return 1},set x(v){this.base=v},get x(){return this.base}};o.x=7;return o.x;"
    ],
    [
      "data to accessor",
      'const o={x:1,get x(){return 7}};return [o.x,Object.hasOwn(Object.getOwnPropertyDescriptor(o,"x"),"value")];'
    ],
    [
      "accessor to data",
      'const o={get x(){return 1},set x(v){},x:7};const d=Object.getOwnPropertyDescriptor(o,"x");return [o.x,d.writable,Object.hasOwn(d,"get")];'
    ],
    ["method to accessor", "const o={x(){return 1},get x(){return 7}};return o.x;"],
    ["accessor to method", "const o={get x(){return 1},x(){return 7}};return o.x();"],
    [
      "super getter receiver",
      "const base={get x(){return this.base}};const o={__proto__:base,base:6,get x(){return super.x+1}};return o.x;"
    ],
    [
      "super setter receiver",
      "const base={set x(v){this.base=v}};const o={__proto__:base,set x(v){super.x=v+1}};o.x=6;return o.base;"
    ],
    [
      "borrowed getter home",
      'const o={__proto__:{x:6},get x(){return super.x+this.base}};const get=Object.getOwnPropertyDescriptor(o,"x").get;return get.call({base:1});'
    ],
    ["getter arrow home", "const o={__proto__:{x:7},get x(){return ()=>super.x}};return o.x();"],
    [
      "proto-named accessor",
      "const o={get __proto__(){return 7},set __proto__(v){this.base=v}};o.__proto__=8;return [o.__proto__,o.base,Object.getPrototypeOf(o)===Object.getPrototypeOf({})];"
    ],
    [
      "accessor and colon prototype",
      "const base={x:8};const o={get __proto__(){return 7},__proto__:base};return [o.__proto__,o.x,Object.getPrototypeOf(o)===base];"
    ],
    [
      "enumeration invokes no getter",
      "let reads=0;const o={get x(){reads++;return 7}};const keys=Object.keys(o);return [keys,reads];"
    ],
    [
      "values and JSON invoke getters",
      "let reads=0;const o={get x(){reads++;return 7}};return [Object.values(o),JSON.stringify(o),reads];"
    ],
    [
      "spread makes data properties",
      'const o={get x(){return 7}};const copy={...o};return [copy.x,Object.getOwnPropertyDescriptor(copy,"x").writable];'
    ],
    ["destructuring reads getter", "const o={get x(){return 7}};const {x}=o;return x;"],
    ["getter thenable", "const o={get then(){return resolve=>resolve(7)}};return await o;"],
    [
      "promise-valued getter",
      "const o={get x(){return Promise.resolve(7)}};const p=o.x;return [typeof p.then,await p];"
    ],
    [
      "getter throw identity",
      "const error={x:7};const o={get x(){throw error}};try{o.x}catch(e){return e===error}"
    ],
    [
      "strict detached getter",
      'const o={get x(){return this}};const get=Object.getOwnPropertyDescriptor(o,"x").get;return get();'
    ],
    [
      "nonconstructible getter",
      'const o={get x(){return 7}};const get=Object.getOwnPropertyDescriptor(o,"x").get;try{new get()}catch(e){return e.name}'
    ],
    ["getter new.target", "const o={get x(){return new.target}};return o.x;"],
    ["line break after get", "const o={get\nx(){return 7}};return o.x;"],
    [
      "ordinary get/set control",
      "const o={get(){return 7},set(v){return v}};return [o.get(),o.set(8)];"
    ],
    ["data get/set control", "const o={get:7,set:8};return [o.get,o.set];"]
  ])("matches native %s", async (_name, source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "const o={get x(v){}};",
    "const o={get x(...v){}};",
    "const o={set x(){}};",
    "const o={set x(a,b){}};",
    "const o={set x(...v){}};",
    "const o={async get x(){}};",
    "const o={*get x(){}};",
    "const o={get x(){super()}};",
    "const o={get x(){await 7}};",
    "const o={set x(v){yield 7}};",
    "const o={set x(v){let v}};",
    'const o={set x(v=7){"use strict";}};',
    'const o={set x({v}){"other";"use strict";}};',
    "({get x(){}}=value);",
    "const {set x(v){}}=value;",
    String.raw`const o={g\u0065t x(){}};`,
    String.raw`const o={s\u0065t x(v){}};`
  ])("rejects native early errors: %s", (source) => {
    expect(() => new Script(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  });
  it.each([
    "const o={set x(v,){}};",
    'const o={set x(v=7){("use strict")}};',
    'const o={set x(v=7){;"use strict"}};',
    String.raw`const o={set x(v=7){"use\x20strict"}};`
  ])("accepts native setter controls: %s", (source) => {
    expect(() => new Script(source)).not.toThrow();
    expect(() => parseModule(source)).not.toThrow();
  });
  it("admits accessors through harness lint", () => {
    expect(
      lint("const o={base:1,get x(){return this.base},set x(v){this.base=v}};o.x=7;return o.x;")
    ).toEqual([]);
  });
  it.each(["const o={get x(){return missing}};", "const o={set x(v=missing){this.x=v}};"])(
    "visits accessor references: %s",
    (source) => {
      expect(AS003(source)).toHaveLength(1);
      expect(AS003(source)[0]?.code).toBe("AS003");
    }
  );
  it("visits getter loops", () => {
    expect(AS_UNBOUNDED_LOOP("const o={get x(){while(true){}}};")).toHaveLength(1);
  });
  it.each(["get", "set"])("accounts for an escaped %s home object", async (kind) => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      expect(
        await realm.evaluate(
          `const accessor=(()=>{const o={payload:"x".repeat(700),${kind} x(${kind === "set" ? "v" : ""}){}};return Object.getOwnPropertyDescriptor(o,"x").${kind}})();`
        )
      ).toMatchObject({ ok: true });
      expect(budget.currentDataSize).toBeGreaterThanOrEqual(700);
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });
  it.each(["get", "set"])("keeps %s step exhaustion fatal", async (kind) => {
    await expect(
      run(
        `const o={${kind} x(${kind === "set" ? "v" : ""}){while(true){}}};try{${kind === "set" ? "o.x=7" : "o.x"}}catch(e){return "caught"}`,
        { budget: new Budget({ maxSteps: 200 }) }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded" });
  });
  it("preserves callable accessor descriptors in snapshots while rejecting lossy data copies", async () => {
    const source = "let calls=0;const o={get x(){calls++;return 7}};return o;";
    const result = await run(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Accessor fixture failed");
    expect(() => deepCopyToSandbox(result.returnValue)).toThrow(/descriptor|accessor|prototype/i);
    const dumped = JSON.parse(await dump(result));
    const encoded = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { value: result.returnValue as RuntimeSnapshotValue } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(encoded)), { source });
    const binding = restored.currentScope.lookup("value");
    if (!binding.found) throw new Error("Missing restored accessor object");
    const descriptor = Object.getOwnPropertyDescriptor(binding.value, "x")!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, get: expect.any(Function), set: undefined });
    expect(await interpret(parseModule("{return value.x}").body[0], {
      budget: restored.budget, bindings: { value: binding.value }
    })).toMatchObject({ ok: true, returnValue: 7 });
    const originalCalls = result.snapshot.bindings.calls;
    expect(originalCalls).toBe(0);
    expect(dumped.heap).toBeDefined();
  });
});
