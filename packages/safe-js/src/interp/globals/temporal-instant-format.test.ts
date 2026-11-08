import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["ceil", 0], ["floor", -1000], ["expand", 0], ["trunc", -1000],
  ["halfCeil", 0], ["halfFloor", -1000], ["halfExpand", 0],
  ["halfTrunc", -1000], ["halfEven", 0]
])("rounds the negative subsecond tie with %s", async (mode, expected) => {
  expect(await run(`return Temporal.Instant.from(new Temporal.Instant(-500000000n)
    .toString({smallestUnit:'second',roundingMode:${JSON.stringify(mode)}})).epochMilliseconds`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each([
  ["ceil", -1, 2], ["floor", -2, 1], ["expand", -1, 2], ["trunc", -2, 1],
  ["halfCeil", -1, 2], ["halfFloor", -2, 1], ["halfExpand", -1, 2],
  ["halfTrunc", -2, 1], ["halfEven", -2, 2]
])("rounds exact times as if positive with %s", async (mode, negative, positive) => {
  expect(await run(`return [-1500000000n,1500000000n].map(epoch =>
    Temporal.Instant.from(new Temporal.Instant(epoch).toString({smallestUnit:'second',roundingMode:${JSON.stringify(mode)}})).epochMilliseconds)`))
    .toMatchObject({ok:true,returnValue:[Number(negative)*1000,Number(positive)*1000]});
});

it.each([
  ["undefined","1969-12-31T23:59:59.123456789Z"],
  ["{fractionalSecondDigits:3}","1969-12-31T23:59:59.123Z"],
  ["{smallestUnit:'minutes'}","1969-12-31T23:59Z"],
  ["{timeZone:'+05:30',fractionalSecondDigits:0}","1970-01-01T05:29:59+05:30"],
  ["{smallestUnit:'second',roundingMode:'ceil'}","1970-01-01T00:00:00Z"]
])("formats Instant with %s", async (options, expected) => {
  expect(await run(`return new Temporal.Instant(-876543211n).toString(${options})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("reads and coerces options in specified order without enumerating", async () => {
  expect(await run(`const events=[];const options=new Proxy({
    fractionalSecondDigits:{toString(){events.push('digits');return 'auto'}},
    roundingMode:{toString(){events.push('mode');return 'trunc'}},
    smallestUnit:{toString(){events.push('unit');return 'seconds'}},timeZone:'UTC'
  },{get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumeration'}});
    const text=new Temporal.Instant(1n).toString(options);return [text,events]`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T00:00:00+00:00",
      ["fractionalSecondDigits","digits","roundingMode","mode","smallestUnit","unit","timeZone"]]});
});

it.each([["hour",true],["day",true],["auto",true],["autos",false],["unknown",false]])("validates unit %s at the specified stage", async (unit, readZone) => {
  expect(await run(`let read=false,name;try{new Temporal.Instant(0n).toString({smallestUnit:${JSON.stringify(unit)},
    get timeZone(){read=true;return {toString(){throw 'coerced'}}}})}catch(e){name=e.name}return [name,read]`))
    .toMatchObject({ok:true,returnValue:["RangeError",readZone]});
});

it("stops at invalid digits and never coerces a time-zone object", async () => {
  expect(await run(`const events=[];let first,second;
    try{new Temporal.Instant(0n).toString({fractionalSecondDigits:'3',get roundingMode(){events.push('mode')}})}catch(e){first=e.name}
    try{new Temporal.Instant(0n).toString({timeZone:{toString(){events.push('zone');return 'UTC'}}})}catch(e){second=e.name}
    return [first,second,events]`)).toMatchObject({ok:true,returnValue:["RangeError","TypeError",[]]});
});

it("toJSON ignores arguments and a replaced toString method", async () => {
  expect(await run(`const value=new Temporal.Instant(1n);value.toString=()=>{throw 'replaced'};
    return [value.toJSON(new Proxy({},{get(){throw 'options'}})),JSON.stringify(value)]`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T00:00:00.000000001Z",'"1970-01-01T00:00:00.000000001Z"']});
});
