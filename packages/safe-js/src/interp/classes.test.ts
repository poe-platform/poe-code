import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";

describe("class construction and public elements", () => {
  it.each(['new Date(0)', 'new Float32Array([7])'])("does not bypass unsupported field descriptors on %s", async receiver => {
    expect(await run(`class A{constructor(){return ${receiver}}}class B extends A{x=7}try{new B()}catch(error){return error.name}`)).toMatchObject({ ok: true, returnValue: "TypeError" });
  });
  it("does not let super assignment mutate private regex metadata", async () => {
    expect(await run('const value=/a/;class A{}class B extends A{write(){super.source="b"}}try{B.prototype.write.call(value)}catch(error){return [error.name,value.source]}')).toMatchObject({ ok: true, returnValue: ["TypeError", "a"] });
  });
  it.each(["read(){}", "async read(){}", "*read(){yield 7}"])("retains an escaped method home object: %s", async method => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      expect(await realm.evaluate(`const method=(class {static payload="x".repeat(700);static ${method}}).read;`)).toMatchObject({ ok: true });
      expect(budget.currentDataSize).toBeGreaterThanOrEqual(700);
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });
  it.each([
    ["empty class", 'class C{}return [typeof C,new C() instanceof C]'],
    ["constructor and method", 'class C{constructor(value){this.value=value}read(){return this.value}}return new C(7).read()'],
    ["anonymous expression", 'const C=class{read(){return 7}};return [C.name,new C().read()]'],
    ["named expression", 'const C=class Local{read(){return Local.name}};return [C.name,new C().read(),typeof Local]'],
    ["outer declaration is mutable", 'class C{}C=7;return C'],
    ["inner name is immutable", 'class C{static change(){C=7}}try{C.change()}catch(error){return error.name}'],
    ["lexical declaration", 'const C=7;{class C{}if(typeof C!=="function")throw 0}return C'],
    ["temporal dead zone", 'let error;try{typeof C}catch(value){error=value.name}class C{}return error'],
    ["class callable rejection", 'class C{}try{C()}catch(error){return error.name}'],
    ["class call rejection", 'class C{}try{C.call({})}catch(error){return error.name}'],
    ["method is not constructible", 'class C{read(){return 7}}const value=new C();try{new value.read()}catch(error){return error.name}'],
    ["strict method receiver", 'class C{read(){return this}}const read=new C().read;return read()'],
    ["borrowed method receiver", 'class C{read(){return this.value}}return new C().read.call({value:7})'],
    ["method identity", 'class C{read(){}}return new C().read===new C().read'],
    ["method descriptors", 'class C{read(a,b){}}const d=Object.getOwnPropertyDescriptor(C.prototype,"read");return [d.enumerable,d.configurable,d.writable,C.prototype.read.name,C.prototype.read.length]'],
    ["prototype descriptor", 'class C{}const d=Object.getOwnPropertyDescriptor(C,"prototype");return [d.enumerable,d.configurable,d.writable,C.prototype.constructor===C]'],
    ["constructor length", 'class C{constructor(a,b=1,c){}}return C.length'],
    ["source text", 'const C=class Named /* comment */ { read () { return 7; } };return [C.toString(),C.prototype.read.toString()]'],
    ["static method", 'class C{static read(){return this.value}}C.value=7;return C.read()'],
    ["static method descriptor", 'class C{static read(){}}const d=Object.getOwnPropertyDescriptor(C,"read");return [d.enumerable,d.configurable,d.writable]'],
    ["static constructor method", 'class C{static constructor(){return 7}}return C.constructor()'],
    ["computed constructor name is a method", 'class C{["constructor"](){return 7}}return new C().constructor()'],
    ["duplicate ordinary method", 'class C{read(){return 1}read(){return 7}}return new C().read()'],
    ["get and set names", 'class C{get(){return 7}set(value){return value}}const value=new C();return [value.get(),value.set(8)]'],
    ["async method", 'class C{async read(){return await Promise.resolve(7)}}return await new C().read()'],
    ["generator method", 'class C{*values(){yield 7;yield 8}}return [...new C().values()]'],
    ["computed method key", 'const log=[];const key={toString(){log.push("key");return "read"}};class C{[key](){return 7}}return [new C().read(),log]'],
    ["computed key outer receiver", 'const owner={value:"read",make(){return class{[this.value](){return 7}}}};const C=owner.make();return new C().read()'],
    ["base return primitive", 'class C{constructor(){this.value=7;return 9}}return new C().value'],
    ["base return object", 'const result={value:7};class C{constructor(){return result}}return new C()===result'],
    ["ordinary inheritance", 'class A{read(){return this.value}}class B extends A{constructor(value){super();this.value=value}}const value=new B(7);return [value.read(),value instanceof A,value instanceof B]'],
    ["default derived constructor", 'class A{constructor(value){this.value=value}}class B extends A{}return new B(7).value'],
    ["ordinary function parent", 'function A(value){this.value=value}A.prototype.read=function(){return this.value};class B extends A{}return new B(7).read()'],
    ["constructor prototype chain", 'class A{}class B extends A{}return [Object.getPrototypeOf(B)===A,Object.getPrototypeOf(B.prototype)===A.prototype]'],
    ["inherited static method", 'class A{static read(){return this.value}}class B extends A{}B.value=7;return B.read()'],
    ["instance super method", 'class A{read(){return this.value}}class B extends A{constructor(){super();this.value=7}read(){return super.read()+1}}return new B().read()'],
    ["static super method", 'class A{static read(){return this.value}}class B extends A{static read(){return super.read()+1}}B.value=7;return B.read()'],
    ["computed super method", 'class A{read(){return this.value}}class B extends A{read(){return super["read"]()}}const value=new B();value.value=7;return value.read()'],
    ["lexical super in arrow", 'class A{read(){return this.value}}class B extends A{read(){return (()=>super.read())()}}const value=new B();value.value=7;return value.read()'],
    ["lexical this before super", 'class A{}class B extends A{constructor(){const read=()=>this;super();this.same=read()===this}}return new B().same'],
    ["this before super", 'class A{}class B extends A{constructor(){this.value=7;super()}}try{new B()}catch(error){return error.name}'],
    ["super property before super call", 'class A{read(){}}class B extends A{constructor(){super.read();super()}}try{new B()}catch(error){return error.name}'],
    ["derived missing super", 'class A{}class B extends A{constructor(){}}try{new B()}catch(error){return error.name}'],
    ["derived object return without super", 'const value={};class A{}class B extends A{constructor(){return value}}return new B()===value'],
    ["derived primitive return", 'class A{}class B extends A{constructor(){super();return 7}}try{new B()}catch(error){return error.name}'],
    ["derived null return", 'class A{}class B extends A{constructor(){return null}}try{new B()}catch(error){return error.name}'],
    ["double super effects", 'let calls=0;class A{constructor(){calls++}}class B extends A{constructor(){super();super()}}try{new B()}catch(error){return [error.name,calls]}'],
    ["new target", 'class A{constructor(){this.target=new.target}}class B extends A{}return [new A().target===A,new B().target===B]'],
    ["ordinary parent new target", 'function A(){this.target=new.target}class B extends A{}return new B().target===B'],
    ["null inheritance explicit object", 'class C extends null{constructor(){return Object.create(new.target.prototype)}}const value=new C();return [Object.getPrototypeOf(C.prototype)===null,value instanceof C]'],
    ["null inheritance default throws", 'class C extends null{}try{new C()}catch(error){return error.name}'],
    ["non-constructor parent", 'try{const C=class extends (()=>{}){}}catch(error){return error.name}'],
    ["invalid parent prototype", 'function A(){}A.prototype=7;try{const C=class extends A{}}catch(error){return error.name}'],
    ["public fields", 'class C{x=7;y;["z"]=8}const value=new C();return [value.x,value.y,value.z,Object.keys(value)]'],
    ["fields before base parameters", 'class C{x=7;constructor(value=this.x){this.value=value}}return new C().value'],
    ["derived field order", 'const log=[];class A{x=log.push("base-field");constructor(){log.push("base-body")}}class B extends A{y=log.push("derived-field");constructor(){log.push("before");super();log.push("after")}}new B();return log'],
    ["field overrides own base data", 'class A{constructor(){this.x=1}}class B extends A{x=7}return new B().x'],
    ["fields initialize returned object", 'const result={};class A{constructor(){return result}}class B extends A{x=7}return [new B()===result,result.x]'],
    ["field lexical receiver", 'class C{x=7;read=()=>this.x}const value=new C();const read=value.read;return read()'],
    ["field new target", 'class C{x=new.target}return new C().x'],
    ["static fields and blocks", 'const log=[];class C{static x=7;static{log.push(this.x);this.x++}static y=this.x}return [C.x,C.y,log]'],
    ["computed keys precede initializers", 'const log=[];class C{[log.push("instance-key")]=1;static [log.push("static-key")]=log.push("static-value");static{log.push("block")}}return log'],
    ["class name in static initializer", 'class C{static same=C===this}return C.same'],
    ["inferred name in static initializer", 'const C=class{static value=this.name};return C.value'],
    ["computed key class TDZ", 'try{class C{[C](){}}}catch(error){return error.name}'],
    ["static field super", 'class A{static value=7}class B extends A{static value=super.value+1}return B.value'],
    ["instance field super", 'class A{read(){return 7}}class B extends A{x=super.read()}return new B().x'],
    ["super assignment receiver", 'class A{}A.prototype.x=1;class B extends A{write(){super.x=7}}const value=new B();value.write();return [value.x,A.prototype.x,Object.hasOwn(value,"x")]'],
    ["super readonly rejection", 'class A{}Object.defineProperty(A.prototype,"x",{value:1});class B extends A{write(){super.x=7}}try{new B().write()}catch(error){return error.name}'],
    ["number subclass", 'class C extends Number{read(){return this.valueOf()}}const value=new C(7);return [value.read(),value instanceof C,value instanceof Number]'],
    ["Object subclass ignores argument", 'class C extends Object{}const value=new C(7);return [value instanceof C,Object.prototype.toString.call(value)]'],
    ["bound class construction", 'class C{constructor(x){this.x=x;this.target=new.target}}const B=C.bind(null,7);const v=new B();return [v.x,v.target===C,v instanceof B,v instanceof C]'],
    ["bound ordinary parent preserves new target", 'function A(x){this.x=x;this.target=new.target}const B=A.bind(null,7);B.prototype=A.prototype;class C extends B{}const v=new C();return [v.x,v.target===C,v instanceof A,v instanceof C]'],
    ["super resolves constructor dynamically", 'class A{constructor(){this.x=1}}class B{constructor(){this.x=7}}class C extends A{}Object.setPrototypeOf(C,B);return new C().x'],
    ["new target arrow and nested function", 'class C{constructor(){this.values=[(()=>new.target)()===C,(function(){return new.target})()]}}return new C().values'],
    ["super write ignores receiver prototype shadow", 'class A{}A.prototype.x=1;class B extends A{write(){super.x=7}}Object.defineProperty(B.prototype,"x",{value:2});const v=new B();v.write();return [v.x,A.prototype.x,B.prototype.x]'],
    ["super updates receiver", 'class A{}A.prototype.x=7;class B extends A{read(){return super.x++}}const v=new B();return [v.read(),v.x,A.prototype.x]'],
    ["super delete is runtime rejection", 'class A{}class B extends A{read(){try{delete super.x}catch(e){return e.name}}}return new B().read()'],
    ["static block var scope", 'class C{static{var x=7;this.x=x}static{this.y=typeof x}}return [C.x,C.y,typeof x]'],
    ["field initializer after defining call returns", 'function make(){return class{value=/a/.test("a")}}const C=make();return new C().value'],
    ["constructor returns callable", 'class C{constructor(){return ()=>7}}return new C()()'],
    ["super tagged receiver", 'class A{read(){return this.value}}class B extends A{read(){return super.read`x`}}const v=new B();v.value=7;return v.read()'],
    ["class fields after parent initializer throws", 'const seen=[];class A{x=(seen.push("a"),1);y=(()=>{throw 7})()}class B extends A{z=seen.push("b")}try{new B()}catch(e){return [e,seen]}'],
    ["anonymous assignment class name", 'let C;C=class{static n=this.name};return C.n'],
    ["anonymous object property class name", 'const o={C:class{static n=this.name}};return o.C.n'],
    ["conditional expression does not infer class name", 'const C=true?class{static n=this.name}:null;return C.n'],
    ["ordinary constructor control", 'function C(value){this.value=value}C.prototype.read=function(){return this.value};return new C(7).read()']
  ])("matches native %s", async (_name, source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
