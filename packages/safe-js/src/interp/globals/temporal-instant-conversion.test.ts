import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["1970-01-01T00:00:00.000000001Z",1n],
  ["1969-12-31T23:59:59.999999999Z",-1n],
  ["1970-01-01T05:30:00+05:30",0n],
  ["+275760-09-13T00:00:00Z",8640000000000000000000n]
])("parses exact Instant string %s", async (source, expected) => {
  expect(await run(`return Temporal.Instant.from(${JSON.stringify(source)}).epochNanoseconds`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("copies branded Instants without observing their coercion properties", async () => {
  expect(await run(`const value=new Temporal.Instant(3n);value.toString=()=>{throw 'unexpected'};
    const copy=Temporal.Instant.from(value);return [copy!==value,copy.epochNanoseconds,copy.toString===value.toString]`))
    .toMatchObject({ok:true,returnValue:[true,3n,false]});
});

it("converts comparison operands once, in order, with a string hint", async () => {
  expect(await run(`const events=[];const a={[Symbol.toPrimitive](hint){events.push('a:'+hint);return '1970-01-01T00:00:00Z'}};
    const b={[Symbol.toPrimitive](hint){events.push('b:'+hint);return '1970-01-01T00:00:00.000000001Z'}};
    return [Temporal.Instant.compare(a,b),events]`))
    .toMatchObject({ok:true,returnValue:[-1,["a:string","b:string"]]});
});

it.each(["0", "0n", "true", "null", "undefined"])("does not stringify primitive input %s", async value => {
  expect(await run(`try{Temporal.Instant.from(${value})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("requires offsets and preserves original coercion failures", async () => {
  expect(await run(`const reason={};let same=false;try{Temporal.Instant.from({toString(){throw reason}})}catch(e){same=e===reason}
    let name;try{Temporal.Instant.from('1970-01-01T00:00:00')}catch(e){name=e.name}return [same,name]`))
    .toMatchObject({ok:true,returnValue:[true,"RangeError"]});
});

it("compares exact nanoseconds and rejects unbranded equals receivers first", async () => {
  expect(await run(`const a=new Temporal.Instant(-1n),b=new Temporal.Instant(0n);let calls=0,name;
    try{Temporal.Instant.prototype.equals.call({}, {toString(){calls++;return ''}})}catch(e){name=e.name}
    return [Temporal.Instant.compare(a,b),Temporal.Instant.compare(b,a),Temporal.Instant.compare(a,a),
      a.equals('1969-12-31T23:59:59.999999999Z'),name,calls]`))
    .toMatchObject({ok:true,returnValue:[-1,1,0,true,"TypeError",0]});
});

it("valueOf always rejects without coercing its receiver", async () => {
  expect(await run(`let calls=0;const value={toString(){calls++;return 'x'}};let name;
    try{Temporal.Instant.prototype.valueOf.call(value)}catch(e){name=e.name}return [name,calls]`))
    .toMatchObject({ok:true,returnValue:["TypeError",0]});
});
