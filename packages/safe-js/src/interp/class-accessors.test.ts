import { Script, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { parseModule } from "../parse/parser.js";
import { lint } from "../lint/index.js";
import { AS003 } from "../lint/rules/AS003.js";
import { AS_UNBOUNDED_LOOP } from "../lint/rules/AS-unbounded-loop.js";

describe("class accessor syntax", () => {
  it.each([
    "class C{get x(){return 7}set x(v){}}",
    "class C{set x(v=7){}}",
    "class C{set x({a}){}}",
    "class C{set x([a]){}}",
    "class C{set x(v,){}}",
    'class C{set x(v=7){("use strict")}}',
    'class C{set x(v=7){;"use strict"}}',
    'class C{set x(v=7){"other";;"use strict"}}',
    String.raw`class C{set x(v=7){"use\x20strict"}}`,
    "class C{static get constructor(){return 7}}",
    'class C{get ["constructor"](){return 7}}',
    "class C{get\nx(){return 7}}",
    "class C{get(){}set(){}}",
    "class C{get get(){return 7}set set(v){}}"
  ])("accepts native syntax: %s", (source) => {
    expect(() => new Script(source)).not.toThrow();
    expect(parseModule(source).body[0]?.type).toBe("ClassDeclaration");
  });

  it.each([
    "class C{get x(v){}}",
    "class C{get x(...v){}}",
    "class C{set x(){}}",
    "class C{set x(a,b){}}",
    "class C{set x(...v){}}",
    "class C{get constructor(){}}",
    "class C{set constructor(v){}}",
    "class C{static get prototype(){}}",
    "class C{static set prototype(v){}}",
    "class C{async get x(){}}",
    "class C{*get x(){}}",
    "class C{get x(){super()}}",
    "class C{get x(){await 7}}",
    "class C{set x(v){yield 7}}",
    "class C{set x(v){let v}}",
    'class C{set x(v=7){"use strict";}}',
    'class C{set x({v}){"use strict";}}',
    'class C{set x(v=7){"other";"use strict";}}',
    String.raw`class C{g\u0065t x(){}}`,
    String.raw`class C{s\u0065t x(v){}}`
  ])("rejects native early errors: %s", (source) => {
    expect(() => new Script(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  });

  it.each([
    ["getter receiver", "class C{base=7;get x(){return this.base}}return new C().x;"],
    ["setter receiver", "class C{set x(v){this.base=v}}const c=new C();c.x=7;return c.base;"],
    [
      "paired accessors",
      "class C{get x(){return this.base}set x(v){this.base=v}}const c=new C();c.x=7;return c.x;"
    ],
    [
      "reverse pair order",
      "class C{set x(v){this.base=v}get x(){return this.base}}const c=new C();c.x=7;return c.x;"
    ],
    [
      "static pair",
      "class C{static get x(){return this.base}static set x(v){this.base=v}}C.x=7;return C.x;"
    ],
    [
      "inherited static receiver",
      "class A{static get x(){return this.base}static set x(v){this.base=v}}class B extends A{}B.x=7;return [B.x,A.base];"
    ],
    [
      "inherited instance receiver",
      "class A{get x(){return this.base}set x(v){this.base=v}}class B extends A{}const b=new B();b.x=7;return b.x;"
    ],
    [
      "super getter",
      "class A{get x(){return this.base}}class B extends A{base=6;get x(){return super.x+1}}return new B().x;"
    ],
    [
      "super setter",
      "class A{get x(){return this.base}set x(v){this.base=v}}class B extends A{get x(){return super.x}set x(v){super.x=v+1}}const b=new B();b.x=6;return b.x;"
    ],
    [
      "static super pair",
      "class A{static get x(){return this.base}static set x(v){this.base=v}}class B extends A{static get x(){return super.x}static set x(v){super.x=v+1}}B.x=6;return [B.x,A.base];"
    ],
    [
      "computed pair",
      'const log=[];class C{get [(log.push("get"),"x")](){return this.base}set [(log.push("set"),"x")](v){this.base=v}}const c=new C();c.x=7;return [c.x,log];'
    ],
    [
      "literal keys",
      'class C{get "x"(){return 7}get 2(){return 8}}const c=new C();return [c.x,c[2]];'
    ],
    [
      "reserved keys",
      "class C{get return(){return 7}get null(){return 8}}const c=new C();return [c.return,c.null];"
    ],
    [
      "descriptor metadata",
      'class C{get x(){return 7}set x(v){}}const d=Object.getOwnPropertyDescriptor(C.prototype,"x");return [d.enumerable,d.configurable,d.get.name,d.set.name,d.get.length,d.set.length,Object.hasOwn(d,"value")];'
    ],
    [
      "getter source",
      'class C{get x() { return 7; }}return Object.getOwnPropertyDescriptor(C.prototype,"x").get.toString();'
    ],
    [
      "static setter source",
      'class C{static set x(v) { this.base=v; }}return Object.getOwnPropertyDescriptor(C,"x").set.toString();'
    ],
    [
      "default setter",
      'class C{set x(v=7){this.base=v}}const c=new C();c.x=undefined;return [c.base,Object.getOwnPropertyDescriptor(C.prototype,"x").set.length];'
    ],
    [
      "destructured setter",
      "class C{set x({v=7}){this.base=v}}const c=new C();c.x={};return c.base;"
    ],
    ["array setter", "class C{set x([v]){this.base=v}}const c=new C();c.x=[7];return c.base;"],
    [
      "getter-only assignment",
      "class C{get x(){return 7}}const c=new C();try{c.x=8}catch(e){return [e.name,c.x]}"
    ],
    ["setter-only read", "class C{set x(v){}}return new C().x;"],
    [
      "override does not merge inherited getter",
      "class A{get x(){return 7}}class B extends A{set x(v){}}return new B().x;"
    ],
    [
      "duplicate getter preserves setter",
      "class C{get x(){return 1}set x(v){this.base=v}get x(){return this.base}}const c=new C();c.x=7;return c.x;"
    ],
    ["method to accessor", "class C{x(){return 1}get x(){return 7}}return new C().x;"],
    [
      "accessor to method",
      'class C{get x(){return 1}set x(v){}x(){return 7}}const d=Object.getOwnPropertyDescriptor(C.prototype,"x");return [new C().x(),d.writable,Object.hasOwn(d,"get")];'
    ],
    [
      "instance field bypasses setter",
      "let calls=0;class A{set x(v){calls++}}class B extends A{x=7}const b=new B();return [b.x,calls];"
    ],
    [
      "static field replaces accessor",
      "let calls=0;class C{static set x(v){calls++}static x=7}return [C.x,calls];"
    ],
    [
      "computed keys before static initialization",
      'const log=[];class C{static value=log.push("field");get [(log.push("key"),"x")](){return 7}static{log.push("block")}}return [new C().x,log];'
    ],
    [
      "getter returning a promise",
      "class C{get x(){return Promise.resolve(7)}}const p=new C().x;return [typeof p.then,await p];"
    ],
    [
      "then accessor",
      "class C{get then(){return resolve=>resolve(7)}}return await Promise.resolve(new C());"
    ],
    [
      "getter throw identity",
      "const error={code:7};class C{get x(){throw error}}try{new C().x}catch(e){return e===error}"
    ],
    [
      "setter throw identity",
      "const error={code:7};class C{set x(v){throw error}}try{new C().x=1}catch(e){return e===error}"
    ],
    [
      "borrowed getter",
      'class C{get x(){return this.base}}const get=Object.getOwnPropertyDescriptor(C.prototype,"x").get;return get.call({base:7});'
    ],
    [
      "strict detached getter",
      'class C{get x(){return this}}const get=Object.getOwnPropertyDescriptor(C.prototype,"x").get;return get();'
    ],
    [
      "accessors are not constructors",
      'class C{get x(){return 7}}const get=Object.getOwnPropertyDescriptor(C.prototype,"x").get;try{new get()}catch(e){return e.name}'
    ],
    ["getter new.target", "class C{get x(){return new.target}}return new C().x;"],
    [
      "update order",
      'const log=[];class C{base=6;get x(){log.push("get");return this.base}set x(v){log.push(v);this.base=v}}const c=new C();const old=c.x++;return [old,c.base,log];'
    ],
    [
      "getter named constructor is computed",
      'class C{get ["constructor"](){return 7}}return new C().constructor;'
    ],
    [
      "ordinary get/set method control",
      "class C{get(){return 7}set(v){return v}}const c=new C();return [c.get(),c.set(8)];"
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("admits supported accessors through the harness lint route", () => {
    expect(
      lint(
        "class C{base=1;get x(){return this.base}set x(v){this.base=v}}const c=new C();c.x=7;return c.x;"
      )
    ).toEqual([]);
  });
  it.each([
    "class C{get x(){return missing}}",
    "class C{set x(v=missing){this.base=v}}",
    "class C{get [missing](){return 7}}"
  ])("visits accessor references in lint: %s", (source) => {
    expect(AS003(source)).toHaveLength(1);
    expect(AS003(source)[0]?.code).toBe("AS003");
  });
  it.each(["get x(){while(true){}}", "set x(v){while(true){}}"])(
    "visits accessor loops: %s",
    (element) => {
      expect(AS_UNBOUNDED_LOOP(`class C{${element}}`)).toHaveLength(1);
    }
  );
  it.each(["get", "set"])(
    "retains the escaped %s home object and releases the realm",
    async (kind) => {
      const budget = new Budget();
      const realm = createRealm({ budget });
      try {
        expect(
          await realm.evaluate(
            `const accessor=(()=>{const C=class{static payload="x".repeat(700);static ${kind} x(${kind === "set" ? "v" : ""}){}};return Object.getOwnPropertyDescriptor(C,"x").${kind}})();`
          )
        ).toMatchObject({ ok: true });
        expect(budget.currentDataSize).toBeGreaterThanOrEqual(700);
      } finally {
        await realm.close();
      }
      expect([...budget.retainedValues()]).toEqual([]);
    }
  );
  it.each(["get", "set"])("keeps %s step exhaustion fatal", async (kind) => {
    await expect(
      run(
        `class C{${kind} x(${kind === "set" ? "v" : ""}){while(true){}}}try{${kind === "set" ? "new C().x=1" : "new C().x"}}catch(e){return "caught"}`,
        { budget: new Budget({ maxSteps: 200 }) }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded" });
  });
});
