import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";

describe("guest accessor properties", () => {
  it.each([
    ["then", "Object.values"],
    ["then", "Object.entries"],
    ["then", "JSON.stringify"],
    ["then", "Number"],
    ["then", "String"],
    ["then", "Array.from"],
    ["catch", "Object.values"],
    ["catch", "JSON.stringify"],
    ["catch", "Number"]
  ])("preserves accessor execution in %s(%s)", async (method, callback) => {
    const source = `const o={};Object.defineProperties(o,{
      x:{get(){return 7},enumerable:true},
      length:{get(){return 1}},
      0:{get(){return 9}},
      valueOf:{get(){return ()=>7}},
      toString:{get(){return ()=>"seven"}}
    });return await Promise.${method === "catch" ? "reject" : "resolve"}(o).${method}(${callback});`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["get", "set"])(
    "accounts for retained %s closures without invoking them",
    async (kind) => {
      const budget = new Budget();
      const realm = createRealm({ budget });
      try {
        expect(
          await realm.evaluate(
            `const object=(()=>{const payload="x".repeat(700);return Object.defineProperty({},"value",{${kind}(){return payload}})})();`
          )
        ).toMatchObject({ ok: true });
        expect(budget.currentDataSize).toBeGreaterThanOrEqual(700);
      } finally {
        await realm.close();
      }
      expect([...budget.retainedValues()]).toEqual([]);
    }
  );
  it.each([
    "map(x=>x+1)",
    "filter(x=>x>1)",
    "find(x=>x<3)",
    "findIndex(x=>x<3)",
    "findLast(x=>x>1)",
    "findLastIndex(x=>x>1)",
    "some(x=>x>2)",
    "every(x=>x>0)",
    "reduce((x,y)=>x+y)",
    "reduceRight((x,y)=>x+y)",
    "forEach(x=>log.push(x))",
    "flatMap(x=>[x,x])",
    "flat()",
    "includes(3)",
    "indexOf(3)",
    "lastIndexOf(3)",
    "join('-')",
    "slice()",
    "concat([4])",
    "splice(0,1,9)",
    "fill(9,0,2)",
    "copyWithin(0,1)",
    "at(0)",
    "sort()",
    "sort((x,y)=>x-y)",
    "reverse()",
    "toSorted()",
    "toSorted((x,y)=>x-y)",
    "toReversed()",
    "toSpliced(1,1)",
    "with(1,9)",
    "push(4)",
    "pop()",
    "shift()",
    "unshift(4)"
  ])("matches array accessor reads/writes in %s", async (method) => {
    const source = `const log=[];const data=[3,1,2];const a=[3,1,2];for(const key of [0,2])Object.defineProperty(a,key,{get(){log.push("get"+key);return data[key]},set(value){log.push("set"+key+":"+value);data[key]=value},configurable:true});const result=a.${method};return [Array.isArray(result)?Array.from(result):result,Array.from(a),log];`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
  it.each([
    [
      "array binding getters including elisions",
      "const log=[];const a=[1,2,3];for(const key of [0,1,2])Object.defineProperty(a,key,{get(){log.push(key);return key+7}});const [,x,...rest]=a;return [x,rest,log];"
    ],
    [
      "array assignment getter",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});let x;[x]=a;return x;'
    ],
    ["array binding stays exhausted", "const a=[];const [x=(a.push(7),1),y]=a;return [x,y];"],
    [
      "array rest materializes holes",
      "const a=Array(2);const [...rest]=a;return [rest.length,Object.hasOwn(rest,0),Object.hasOwn(rest,1)];"
    ],
    [
      "array catch getter",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});try{throw a}catch([x]){return x}'
    ],
    [
      "array parameter getter",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return (([x])=>x)(a);'
    ],
    [
      "array-like callback getters",
      "const o={0:1};Object.defineProperties(o,{length:{get(){return 1}},0:{get(){return 7}}});return [].map.call(o,x=>x+1);"
    ],
    [
      "nested array flatten getters",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return [a].flat();'
    ],
    [
      "string array coercion getter",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return String(a);'
    ],
    [
      "custom join getter",
      'const a=[];Object.defineProperty(a,"join",{get(){return ()=>"seven"}});return String(a);'
    ],
    ["cyclic array join control", "const a=[];a.push(a,1);return a.join();"],
    [
      "function method getter",
      'function f(){}Object.defineProperty(f,"method",{get(){return function(){return this===f}}});return f.method();'
    ],
    [
      "function tagged getter",
      'function f(){}Object.defineProperty(f,"method",{get(){return function(){return this===f}}});return f.method`text`;'
    ],
    [
      "apply reads argument getters",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return ((x)=>x).apply(null,a);'
    ],
    [
      "bind reads name and length once in order",
      'const log=[];function f(){}Object.defineProperties(f,{length:{get(){log.push("length");return 3}},name:{get(){log.push("name");return "named"}}});const b=f.bind(null,7);return [b.length,b.name,log];'
    ],
    [
      "instanceof reads callable prototype getter",
      'const p={};const f=()=>{};Object.defineProperty(f,"prototype",{get(){return p}});return Object.create(p) instanceof f;'
    ],
    [
      "String.raw reads raw getter",
      'const o={};Object.defineProperty(o,"raw",{get(){return ["a","b"]}});return String.raw(o,7);'
    ],
    [
      "String.raw reads part getter",
      'const raw=["a","b"];Object.defineProperty(raw,"0",{get(){return "seven"}});return String.raw({raw},7);'
    ],
    [
      "String.raw array-like getters",
      'const log=[];const raw={};Object.defineProperties(raw,{length:{get(){log.push("length");return 1}},0:{get(){log.push("part");return "seven"}}});return [String.raw({raw}),log];'
    ],
    [
      "Map reads entry getters",
      'const log=[];const pair=[];Object.defineProperties(pair,{0:{get(){log.push(0);return "key"}},1:{get(){log.push(1);return 7}}});return [new Map([pair]).get("key"),log];'
    ],
    [
      "fromEntries reads entry getters",
      'const pair=[];Object.defineProperties(pair,{0:{get(){return "key"}},1:{get(){return 7}}});return Object.fromEntries([pair]);'
    ],
    [
      "Promise.catch reads then getter",
      'const o={};Object.defineProperty(o,"then",{get(){return function(a,b){return b(7)}}});return Promise.resolve().catch.call(o,x=>x+1);'
    ],
    [
      "Promise executor does not inherit new.target",
      "return await new Promise(function(resolve){resolve(new.target===undefined)});"
    ],
    [
      "Promise reaction does not inherit new.target",
      "function C(){return Promise.resolve().then(function(){return new.target===undefined})}return await new C();"
    ],
    [
      "Promise.finally reads constructor and then getters",
      'const log=[];const o={};Object.defineProperties(o,{constructor:{get(){log.push("constructor");return undefined}},then:{get(){log.push("then");return function(a,b){return a(7)}}}});return [await Promise.resolve().finally.call(o,()=>{}),log];'
    ],
    [
      "Promise.all reads resolve getter",
      'const log=[];function C(executor){return new Promise(executor)}Object.defineProperty(C,"resolve",{get(){log.push("resolve");return x=>Promise.resolve(x)}});return [await Promise.all.call(C,[7]),log];'
    ],
    [
      "then getter resolution ordering",
      'const log=[];const o={};Object.defineProperty(o,"then",{get(){log.push("get");return resolve=>{log.push("then");resolve(7)}}});const p=Promise.resolve(o);log.push("after");const n=await p;return [n,log];'
    ],
    [
      "async return then getter ordering",
      'const log=[];const o={};Object.defineProperty(o,"then",{get(){log.push("get");return resolve=>{log.push("then");resolve(7)}}});async function f(){return o}const p=f();log.push("after");return [await p,log];'
    ],
    [
      "descriptor field order",
      'const log=[];const d={};for(const key of ["enumerable","configurable","value","writable","get","set"])Object.defineProperty(d,key,{get(){log.push(key);return undefined}});try{Object.defineProperty({},"x",d)}catch(e){return [e.name,log]}'
    ],
    [
      "defineProperty target before coercion",
      'const log=[];try{Object.defineProperty(null,{toString(){log.push("key");return "x"}},{value:7})}catch(e){return [e.name,log]}'
    ],
    [
      "defineProperties target before descriptor reads",
      'const log=[];const d={};Object.defineProperty(d,"x",{get(){log.push("get");return {value:7}},enumerable:true});try{Object.defineProperties(null,d)}catch(e){return [e.name,log]}'
    ],
    [
      "values recheck enumerability",
      'const o={};Object.defineProperty(o,"a",{get(){Object.defineProperty(o,"b",{enumerable:false});return 7},enumerable:true});Object.defineProperty(o,"b",{value:8,enumerable:true,configurable:true});return Object.values(o);'
    ],
    [
      "assign interleaves getter and setter",
      'const log=[];const source={};const target={};for(const key of ["a","b"]){Object.defineProperty(source,key,{get(){log.push("get"+key);return 7},enumerable:true});Object.defineProperty(target,key,{set(v){log.push("set"+key+v)}})}Object.assign(target,source);return log;'
    ],
    [
      "own getter",
      'const o={base:7};Object.defineProperty(o,"x",{get(){return this.base}});return o.x;'
    ],
    [
      "repeated getter reads",
      'let calls=0;const o={};Object.defineProperty(o,"x",{get(){return ++calls}});return [o.x,o.x,calls];'
    ],
    [
      "setter receiver",
      'const o={};Object.defineProperty(o,"x",{set(value){this.saved=value}});o.x=7;return o.saved;'
    ],
    [
      "assignment value ignores setter return",
      'const o={};Object.defineProperty(o,"x",{set(value){return 9}});return o.x=7;'
    ],
    [
      "setter only read",
      'const o={};Object.defineProperty(o,"x",{set(value){this.saved=value}});return o.x;'
    ],
    [
      "getter only strict assignment",
      'const o={};Object.defineProperty(o,"x",{get(){return 7}});try{o.x=8}catch(e){return e.name}'
    ],
    [
      "undefined getter",
      'const o={};Object.defineProperty(o,"x",{get:undefined});return [o.x,"x" in o];'
    ],
    [
      "undefined setter",
      'const o={};Object.defineProperty(o,"x",{set:undefined});try{o.x=7}catch(e){return e.name}'
    ],
    [
      "inherited getter receiver",
      'const p={};Object.defineProperty(p,"x",{get(){return this.base}});const o=Object.create(p);o.base=7;return o.x;'
    ],
    [
      "inherited setter receiver",
      'const p={};Object.defineProperty(p,"x",{set(v){this.base=v}});const o=Object.create(p);o.x=7;return [o.base,Object.hasOwn(o,"x"),p.base];'
    ],
    [
      "data property shadows inherited getter",
      'const p={};Object.defineProperty(p,"x",{get(){throw 7}});const o=Object.create(p);Object.defineProperty(o,"x",{value:8});return o.x;'
    ],
    [
      "accessor descriptor shape",
      'const get=()=>7;const o={};Object.defineProperty(o,"x",{get});const d=Object.getOwnPropertyDescriptor(o,"x");return [d.get===get,d.set,d.enumerable,d.configurable,Object.hasOwn(d,"value"),Object.hasOwn(d,"writable")];'
    ],
    [
      "descriptor inspection does not execute getters",
      'let calls=0;const o={};Object.defineProperty(o,"x",{get(){calls++;return 7}});Object.getOwnPropertyDescriptors(o);return calls;'
    ],
    [
      "keys do not execute getters",
      'let calls=0;const o={};Object.defineProperty(o,"x",{get(){calls++;return 7},enumerable:true});return [Object.keys(o),calls];'
    ],
    [
      "values execute getters",
      'const o={};Object.defineProperty(o,"x",{get(){return 7},enumerable:true});return Object.values(o);'
    ],
    [
      "entries execute getters",
      'const o={};Object.defineProperty(o,"x",{get(){return 7},enumerable:true});return Object.entries(o);'
    ],
    [
      "object spread reads getters once",
      'let calls=0;const o={};Object.defineProperty(o,"x",{get(){return ++calls},enumerable:true});const copy={...o};return [copy.x,copy.x,calls];'
    ],
    [
      "assign reads getters and calls setters",
      'const log=[];const a={};const b={};Object.defineProperty(a,"x",{get(){log.push("get");return 7},enumerable:true});Object.defineProperty(b,"x",{set(v){log.push(v)}});Object.assign(b,a);return log;'
    ],
    [
      "destructuring reads getters",
      'const o={};Object.defineProperty(o,"x",{get(){return 7}});const {x}=o;return x;'
    ],
    [
      "object rest reads getters",
      'const o={};Object.defineProperty(o,"x",{get(){return 7},enumerable:true});const {...copy}=o;return copy.x;'
    ],
    [
      "catch pattern reads getters",
      'const o={};Object.defineProperty(o,"x",{get(){return 7}});try{throw o}catch({x}){return x}'
    ],
    [
      "compound assignment order",
      'const log=[];const o={};Object.defineProperty(o,"x",{get(){log.push("get");return 7},set(v){log.push(v)}});const result=o.x+=2;return [result,log];'
    ],
    [
      "postfix update",
      'const log=[];const o={};Object.defineProperty(o,"x",{get(){return 7},set(v){log.push(v)}});return [o.x++,log];'
    ],
    [
      "logical assignment short circuit",
      'let writes=0;const o={};Object.defineProperty(o,"x",{get(){return 7},set(v){writes++}});return [o.x||=9,writes];'
    ],
    [
      "super getter receiver",
      'class A{}Object.defineProperty(A.prototype,"x",{get(){return this.base}});class B extends A{read(){return super.x}}const o=new B();o.base=7;return o.read();'
    ],
    [
      "super setter receiver",
      'class A{}Object.defineProperty(A.prototype,"x",{set(v){this.base=v}});class B extends A{write(){super.x=7}}const o=new B();o.write();return o.base;'
    ],
    [
      "super data write does not call receiver accessor",
      'class A{}A.prototype.x=1;class B extends A{write(){super.x=7}}const o=new B();Object.defineProperty(o,"x",{set(v){throw 9}});try{o.write()}catch(e){return e.name}'
    ],
    [
      "field definition bypasses inherited setter",
      'class A{}Object.defineProperty(A.prototype,"x",{set(v){throw 9}});class B extends A{x=7}return new B().x;'
    ],
    [
      "array getter index",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return a[0];'
    ],
    [
      "array map getter index",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return a.map(v=>v+1);'
    ],
    [
      "array join getter index",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return a.join(",");'
    ],
    [
      "array spread getter index",
      'const a=[1];Object.defineProperty(a,"0",{get(){return 7}});return [...a];'
    ],
    [
      "array-like length getter",
      'const o={0:7};Object.defineProperty(o,"length",{get(){return 1}});return Array.from(o);'
    ],
    [
      "coercion hook getter",
      'const log=[];const o={};Object.defineProperty(o,"valueOf",{get(){log.push("get");return function(){log.push("call");return 7}}});return [Number(o),log];'
    ],
    [
      "JSON reads getters",
      'const o={};Object.defineProperty(o,"x",{get(){return 7},enumerable:true});return JSON.stringify(o);'
    ],
    [
      "JSON captures array length before getters",
      'const a=[1,2,3];Object.defineProperty(a,"0",{get(){a.length=1;return 7}});return JSON.stringify(a);'
    ],
    [
      "toJSON getter",
      'const o={};Object.defineProperty(o,"toJSON",{get(){return ()=>7}});return JSON.stringify(o);'
    ],
    [
      "async getter result is not eagerly awaited",
      'const o={};Object.defineProperty(o,"x",{get:async()=>7});return [typeof o.x,await o.x];'
    ],
    [
      "then getter on ordinary object return",
      'let calls=0;const o={};Object.defineProperty(o,"then",{get(){calls++;return undefined}});function read(){return o}return [read()===o,calls];'
    ],
    [
      "promise resolution reads then once",
      'let reads=0;const o={};Object.defineProperty(o,"then",{get(){reads++;return resolve=>resolve(7)}});const value=await Promise.resolve(o);return [value,reads];'
    ],
    [
      "await reads then once",
      'let reads=0;const o={};Object.defineProperty(o,"then",{get(){reads++;return resolve=>resolve(7)}});const value=await o;return [value,reads];'
    ],
    [
      "throwing getter",
      'const o={};Object.defineProperty(o,"x",{get(){throw 7}});try{o.x}catch(e){return e}'
    ],
    [
      "throwing then getter rejects",
      'const o={};Object.defineProperty(o,"then",{get(){throw 7}});try{await Promise.resolve(o)}catch(e){return e}'
    ],
    [
      "freeze preserves setter behavior",
      'const o={};let saved;Object.defineProperty(o,"x",{set(v){saved=v},configurable:true});Object.freeze(o);o.x=7;return [saved,Object.isFrozen(o)];'
    ],
    [
      "nonconfigurable accessor identity",
      'const get=()=>7;const o={};Object.defineProperty(o,"x",{get});Object.defineProperty(o,"x",{get});try{Object.defineProperty(o,"x",{get:()=>8})}catch(e){return [o.x,e.name]}'
    ],
    [
      "accessor to data conversion",
      'const o={};Object.defineProperty(o,"x",{get(){return 7},configurable:true});Object.defineProperty(o,"x",{value:8});const d=Object.getOwnPropertyDescriptor(o,"x");return [o.x,d.writable,Object.hasOwn(d,"get")];'
    ],
    [
      "data to accessor conversion",
      'const o={x:1};Object.defineProperty(o,"x",{get(){return 7}});const d=Object.getOwnPropertyDescriptor(o,"x");return [o.x,d.enumerable,d.configurable,Object.hasOwn(d,"writable")];'
    ],
    [
      "partial accessor update preserves getter",
      'const o={};Object.defineProperty(o,"x",{get(){return this.base},configurable:true});Object.defineProperty(o,"x",{set(v){this.base=v}});o.x=7;return o.x;'
    ],
    [
      "inherited descriptor fields",
      'const o={};Object.defineProperty(o,"x",Object.create({get(){return 7},enumerable:true}));return [o.x,Object.keys(o)];'
    ],
    [
      "defineProperties validates before defining",
      'const o={};try{Object.defineProperties(o,{x:{get(){return 7}},y:{get:7}})}catch(e){return [e.name,Object.keys(o),Object.hasOwn(o,"x")]}'
    ],
    [
      "delete configurable accessor",
      'const o={};Object.defineProperty(o,"x",{get(){return 7},configurable:true});return [delete o.x,"x" in o];'
    ],
    ["data descriptor control", 'const o={};Object.defineProperty(o,"x",{value:7});return o.x;'],
    [
      "invalid mixed descriptor control",
      'try{Object.defineProperty({},"x",{get:()=>7,value:8})}catch(e){return e.name}'
    ]
  ])("matches native %s", async (_name, source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
