import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";
import { temporalInstantEpoch } from "../temporal-instant.js";

it.each(["0n", "1n", "-1n", "8640000000000000000000n", "-8640000000000000000000n"])("constructs exact Instant epoch %s", epoch => {
  return expect(run(`const value=new Temporal.Instant(${epoch});return [value.epochNanoseconds===${epoch},
    value instanceof Temporal.Instant,Object.prototype.toString.call(value)]`))
    .resolves.toMatchObject({ok:true,returnValue:[true,true,"[object Temporal.Instant]"]});
});

it.each([["-1n",-1],["-1000001n",-2],["999999n",0],["1000000n",1]])("floors %s to epoch milliseconds", async (epoch, expected) => {
  expect(await run(`return new Temporal.Instant(${epoch}).epochMilliseconds`)).toMatchObject({ok:true,returnValue:expected});
});

it("requires new before coercion and range-checks before newTarget prototype lookup", async () => {
  expect(await run(`const events=[];const input={valueOf(){events.push('value');return 8640000000000000000001n}};
    try{Temporal.Instant(input)}catch(e){events.push(e.name)}
    const target=new Proxy(function(){},{get(t,k){if(k==='prototype')events.push('prototype');return Reflect.get(t,k)}});
    try{Reflect.construct(Temporal.Instant,[input],target)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","value","RangeError"]});
});

it("coerces with the number hint and preserves subclasses through public replay", async () => {
  const source=`const events=[];class Derived extends Temporal.Instant{};
    const value=new Derived({[Symbol.toPrimitive](hint){events.push(hint);return '17'}});
    await 0;return [value.epochNanoseconds,value instanceof Derived,Object.getPrototypeOf(value)===Derived.prototype,events]`;
  const original=await run(source);
  expect(original).toMatchObject({ok:true,returnValue:[17n,true,true,["number"]]});
  expect(await run(source,{snapshot:JSON.parse(await dump(original))})).toMatchObject({ok:true,returnValue:original.returnValue});
});

it.each(["0", "undefined", "null", "Symbol()"])("rejects non-BigInt-convertible epoch %s", async expression => {
  expect(await run(`try{new Temporal.Instant(${expression})}catch(e){return e.name}`)).toMatchObject({ok:true,returnValue:"TypeError"});
});

it("rejects unbranded getter receivers without invoking Proxy traps", async () => {
  expect(await run(`const events=[];const getter=Object.getOwnPropertyDescriptor(Temporal.Instant.prototype,'epochNanoseconds').get;
    const target=new Proxy(new Temporal.Instant(0n),{get(){events.push('get')}});
    let name;try{getter.call(target)}catch(e){name=e.name}return [name,events]`))
    .toMatchObject({ok:true,returnValue:["TypeError",[]]});
});

it("converts numeric epoch factories using their distinct primitive rules", async () => {
  expect(await run(`return [Temporal.Instant.fromEpochMilliseconds('17').epochNanoseconds,
    Temporal.Instant.fromEpochNanoseconds(true).epochNanoseconds,
    Temporal.Instant.fromEpochMilliseconds(-1).epochNanoseconds]`))
    .toMatchObject({ok:true,returnValue:[17000000n,1n,-1000000n]});
});

it.each([
  ["fromEpochMilliseconds","1n","TypeError"],
  ["fromEpochNanoseconds","1","TypeError"],
  ["fromEpochMilliseconds","1.1","RangeError"],
  ["fromEpochMilliseconds","NaN","RangeError"],
  ["fromEpochMilliseconds","Infinity","RangeError"],
  ["fromEpochMilliseconds","8640000000000001","RangeError"]
])("validates %s(%s)", async (method, argument, expected) => {
  expect(await run(`try{Temporal.Instant.${method}(${argument})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("ignores the factory receiver and uses the original intrinsic prototype", async () => {
  expect(await run(`const original=Temporal.Instant.prototype;const factory=Temporal.Instant.fromEpochNanoseconds;
    Temporal.Instant=function Other(){};const value=factory.call(null,1n);
    return Object.getPrototypeOf(value)===original`)).toMatchObject({ok:true,returnValue:true});
});

it("uses a foreign SDK newTarget realm when its prototype is primitive", async () => {
  const local=await run("return Temporal.Instant");
  const foreign=await run("function Target(){};Target.prototype=1;return [Target,Temporal.Instant.prototype]");
  if (!isSandboxClosure(local.returnValue) || !Array.isArray(foreign.returnValue) || !isSandboxClosure(foreign.returnValue[0]))
    throw new Error("Expected SDK constructors");
  const value=await local.returnValue.construct!([3n],{stack:[],newTarget:foreign.returnValue[0]});
  expect(temporalInstantEpoch(value)).toBe(3n);
  expect(getSandboxPrototype(value as object)).toBe(foreign.returnValue[1]);
});

it("exposes non-enumerable namespace, constructor, factory and getter metadata", async () => {
  expect(await run(`const ctor=Temporal.Instant;const getter=Object.getOwnPropertyDescriptor(ctor.prototype,'epochNanoseconds');
    return [ctor.name,ctor.length,Object.getOwnPropertyDescriptor(ctor,'prototype').writable,
      Object.getOwnPropertyDescriptor(Temporal,'Instant').enumerable,
      ctor.fromEpochMilliseconds.length,getter.enumerable,getter.configurable,getter.get.name,getter.get.length]`))
    .toMatchObject({ok:true,returnValue:["Instant",1,false,false,1,false,true,"get epochNanoseconds",0]});
});
