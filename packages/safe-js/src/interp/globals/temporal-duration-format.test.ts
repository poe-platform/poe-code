import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["{seconds:0}","PT0S"], ["{years:1,months:2,weeks:3,days:4,hours:5,minutes:6,seconds:7,milliseconds:8,microseconds:9,nanoseconds:10}","P1Y2M3W4DT5H6M7.00800901S"],
  ["{seconds:-1,nanoseconds:-1}","-PT1.000000001S"], ["{hours:25,seconds:60}","PT25H60S"],
  ["{seconds:9007199254740991,nanoseconds:999999999}","PT9007199254740991.999999999S"]
])("formats %s exactly", async (input,expected) => {
  expect(await run(`const d=Temporal.Duration.from(${input});return [d.toString(),d.toJSON(),JSON.stringify(d)]`))
    .toMatchObject({ok:true,returnValue:[expected,expected,JSON.stringify(expected)]});
});

it("uses private fields and toJSON ignores options and replaced toString", async () => {
  expect(await run(`const d=Temporal.Duration.from('PT1S');Object.defineProperty(d,'seconds',{get(){throw 'shadow'}});
    d.toString=()=>{throw 'override'};return d.toJSON(new Proxy({},{get(){throw 'options'}}))`))
    .toMatchObject({ok:true,returnValue:"PT1S"});
});

it("reads options alphabetically with string-hint conversions", async () => {
  expect(await run(`const events=[];const option=v=>({[Symbol.toPrimitive](hint){events.push(hint);return v}});
    const options=new Proxy({fractionalSecondDigits:option('auto'),roundingMode:option('ceil'),smallestUnit:option('seconds')},
      {get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumerated'}});
    return [Temporal.Duration.from('PT1.1S').toString(options),events]`))
    .toMatchObject({ok:true,returnValue:["PT2S",["fractionalSecondDigits","string","roundingMode","string","smallestUnit","string"]]});
});

it.each(["null","1","'seconds'"])("rejects nonobject options %s", async options => {
  expect(await run(`try{new Temporal.Duration().toString(${options})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it.each(["{fractionalSecondDigits:10}","{fractionalSecondDigits:'3'}","{roundingMode:'invalid'}",
  "{smallestUnit:'minute'}","{smallestUnit:'hour'}","{smallestUnit:'day'}","{smallestUnit:'auto'}"])("rejects invalid formatting options %s", async options => {
  expect(await run(`try{new Temporal.Duration().toString(${options})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("validates the receiver and each option before reading the next", async () => {
  expect(await run(`const events=[];try{Temporal.Duration.prototype.toString.call({},new Proxy({},{get(){events.push('read')}}))}catch(e){events.push(e.name)}
    try{new Temporal.Duration().toString({fractionalSecondDigits:10,get roundingMode(){events.push('later')}})}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","RangeError"]});
});

it.each([1,-1])("rounds signed half-second ties with sign %s", async sign => {
  const modes=["ceil","floor","expand","trunc","halfCeil","halfFloor","halfExpand","halfTrunc","halfEven"];
  const expected=sign===1?["PT1S","PT0S","PT1S","PT0S","PT1S","PT0S","PT1S","PT0S","PT0S"]:
    ["PT0S","-PT1S","-PT1S","PT0S","PT0S","-PT1S","-PT1S","PT0S","PT0S"];
  expect(await run(`const d=Temporal.Duration.from({milliseconds:${sign*500}});return ${JSON.stringify(modes)}.map(roundingMode=>d.toString({smallestUnit:'second',roundingMode}))`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("floors numeric precision, lets smallestUnit override it, and preserves method metadata in replay", async () => {
  const source=`const d=Temporal.Duration.from('PT1.23456789S');const metadata=['toString','toJSON'].map(name=>{
    const desc=Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,name);let error;try{new desc.value()}catch(e){error=e.name}
    return [desc.value.name,desc.value.length,desc.enumerable,desc.writable,desc.configurable,error]});await 0;
    return [d.toString({fractionalSecondDigits:2.9}),d.toString({fractionalSecondDigits:9,smallestUnit:'milliseconds'}),metadata]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["PT1.23S","PT1.234S",[["toString",0,false,true,true,"TypeError"],["toJSON",0,false,true,true,"TypeError"]]]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it.each([0,3,6])("formats rounded negative zero without a sign at precision %s", async digits => {
  const expected=digits===0?"PT0S":`PT0.${"0".repeat(digits)}S`;
  expect(await run(`return Temporal.Duration.from({nanoseconds:-1}).toString({fractionalSecondDigits:${digits}})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("keeps the negative sign when calendar fields remain after time rounds to zero", async () => {
  expect(await run(`return Temporal.Duration.from({years:-1,nanoseconds:-1}).toString({fractionalSecondDigits:0})`))
    .toMatchObject({ok:true,returnValue:"-P1YT0S"});
});
