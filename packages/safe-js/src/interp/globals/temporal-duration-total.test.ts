import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it.each([
  ["{hours: 1, minutes: 30}", "'hours'", 1.5],
  ["{days: 1, hours: 12}", "'day'", 1.5],
  ["{hours: -1, minutes: -30}", "{unit:'minutes'}", -90],
  ["{hours:816, nanoseconds:2049187497660}", "'hour'", 816.56921874935],
  ["{nanoseconds:9007199254740992, microseconds:1}", "'nanosecond'", 9007199254741992],
  ["{months:1}", "{unit:'days',relativeTo:'2024-01-31'}", 29],
  ["{months:1,days:4}", "{unit:'month',relativeTo:'2023-01-31'}", 1.1290322580645162],
  ["{months:-1,days:-4}", "{unit:'month',relativeTo:'2023-01-31'}", -1.1290322580645162],
  ["{years:1}", "{unit:'days',relativeTo:'2024-01-01'}", 366],
  ["{days:1}", "{unit:'hours',relativeTo:'2024-03-09T12:00[America/New_York]'}", 23],
  ["{days:1}", "{unit:'hours',relativeTo:'2024-11-02T12:00[America/New_York]'}", 25],
  ["{months:1}", "{unit:'days',relativeTo:{year:2024,month:1,day:31}}", 29],
  ["{days:1}", "{unit:'hours',relativeTo:{year:2024,month:3,day:9,hour:12,timeZone:'America/New_York'}}", 23],
  ["{days:1}", "{unit:'hours',relativeTo:{calendar:'gregory',year:2020,month:1,day:1}}", 24]
] as const)("totals %s with %s", async (fields, options, expected) => {
  expect(await run(`return Temporal.Duration.from(${fields}).total(${options})`))
    .toMatchObject({ ok: true, returnValue: expected });
});

it("returns positive zero for a blank duration", async () => {
  expect(await run("return Object.is(new Temporal.Duration().total('hours'),0)"))
    .toMatchObject({ ok: true, returnValue: true });
});

it.each(["2023-01-01", "2023-01-01T00:00[UTC]"])("rounds fractional years exactly relative to %s", async relativeTo => {
  expect(await run(`return Temporal.Duration.from({seconds:15702706,nanoseconds:861721167})
    .total({relativeTo:${JSON.stringify(relativeTo)},unit:'year'})`))
    .toMatchObject({ ok: true, returnValue: 0.497929568167211 });
});

it.each([
  ["year", "2023-01-01", 365n * 86400000000000n],
  ["year", "2023-01-01T00:00[UTC]", 365n * 86400000000000n],
  ["month", "2023-01-01", 31n * 86400000000000n],
  ["week", "2023-01-01", 7n * 86400000000000n]
] as const)("matches exact signed %s fractions relative to %s", async (unit, relativeTo, divisor) => {
  const numerator = 15702706861721167n % divisor;
  const expected = Number(`0.${(numerator * 10n ** 120n / divisor).toString().padStart(120, "0")}`);
  const source = `return [1,-1].map(sign=>Temporal.Duration.from({
    seconds:sign*${numerator / 1000000000n},nanoseconds:sign*${numerator % 1000000000n}
  }).total({unit:${JSON.stringify(unit)},relativeTo:${JSON.stringify(relativeTo)}}))`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [expected, -expected] });
});

it("rounds whole years and the remaining leap-year fraction together", async () => {
  const interval = 366n * 86400000000000n;
  const remainder = 15702706861721167n;
  const expected = Number(`1.${(remainder * 10n ** 120n / interval).toString().padStart(120, "0")}`);
  expect(await run(`return Temporal.Duration.from({years:1,seconds:15702706,nanoseconds:861721167})
    .total({unit:'years',relativeTo:'2023-01-01'})`)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  ["undefined", "TypeError"], ["null", "TypeError"], ["1", "TypeError"],
  ["{}", "RangeError"], ["{unit:'auto'}", "RangeError"],
  ["{unit:'weeks'}", "RangeError"], ["{unit:Symbol()}", "TypeError"]
])("rejects invalid total options %s", async (options, expected) => {
  expect(await run(`let name;try {new Temporal.Duration().total(${options})}catch(error){name=error.name}return name`))
    .toMatchObject({ ok: true, returnValue: expected });
});

it("requires relativeTo when the duration contains calendar units", async () => {
  expect(await run(`return ['years','months','weeks'].map(field=>{
    try {Temporal.Duration.from({[field]:1}).total('hours')}catch(error){return error.name}
  })`)).toMatchObject({ ok: true, returnValue: ["RangeError", "RangeError", "RangeError"] });
});

it("validates relativeTo before reading unit", async () => {
  expect(await run(`const events=[];let name;try {new Temporal.Duration().total({
    get relativeTo(){events.push('relativeTo');return 'invalid'},
    get unit(){events.push('unit');return 'hours'}
  })}catch(error){name=error.name}return [name,events]`))
    .toMatchObject({ ok: true, returnValue: ["RangeError", ["relativeTo"]] });
});

it("reads relative property bags alphabetically without enumerating or coercing the bag", async () => {
  const keys = ["calendar", "day", "hour", "microsecond", "millisecond", "minute", "month", "monthCode", "nanosecond", "offset", "second", "timeZone", "year"];
  expect(await run(`const events=[];const relativeTo=new Proxy({year:2024,month:1,day:31},{
    get(target,key){events.push(key);return target[key]},ownKeys(){throw 'enumerated'}
  }); const total=Temporal.Duration.from({months:1}).total({relativeTo,
    get unit(){events.push('unit');return {toString(){events.push('coerce unit');return 'days'}}}
  });return [total,events]`))
    .toMatchObject({ ok: true, returnValue: [29, [...keys, "unit", "coerce unit"]] });
});

it("stops field conversion before later fields and unit are read", async () => {
  expect(await run(`const events=[];let name;try {new Temporal.Duration().total({
    relativeTo:{day:0,get hour(){events.push('hour')}},get unit(){events.push('unit')}
  })}catch(error){name=error.name}return [name,events]`))
    .toMatchObject({ ok: true, returnValue: ["RangeError", []] });
});

it("checks the private brand before total option getters", async () => {
  expect(await run(`const events=[];let name;try {Temporal.Duration.prototype.total.call({},
    {get relativeTo(){events.push('relativeTo')}})}catch(error){name=error.name}return [name,events]`))
    .toMatchObject({ ok: true, returnValue: ["TypeError", []] });
});

it("uses private fields even when public getters are replaced", async () => {
  expect(await run(`const duration=Temporal.Duration.from({hours:2});
    Object.defineProperty(duration,'hours',{get(){throw 'public getter'}});
    duration.toString=()=>{throw 'public conversion'};
    return duration.total('minutes')`)).toMatchObject({ ok: true, returnValue: 120 });
});

it("exposes standard method metadata", async () => {
  expect(await run(`const descriptor=Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,'total');
    const method=descriptor.value;let error;try{new method()}catch(e){error=e.name}
    return [method.name,method.length,descriptor.writable,descriptor.enumerable,descriptor.configurable,error]`))
    .toMatchObject({ ok: true, returnValue: ["total", 1, true, false, true, "TypeError"] });
});

it("coerces monthCode and offset with string-hint ToPrimitive in field order", async () => {
  expect(await run(`const events=[];const relativeTo={year:2024,day:1,timeZone:'UTC',
    monthCode:{[Symbol.toPrimitive](hint){events.push('monthCode:'+hint);return 'M01'}},
    offset:{[Symbol.toPrimitive](hint){events.push('offset:'+hint);return '+00:00'}}
  };return [Temporal.Duration.from({days:1}).total({relativeTo,unit:'hours'}),events]`))
    .toMatchObject({ ok: true, returnValue: [24, ["monthCode:string", "offset:string"]] });
});

it("replays a captured total method without repeating the host checkpoint", async () => {
  let calls = 0;
  const checkpoint = async () => { calls++; };
  const source = `const duration=Temporal.Duration.from({days:1});const total=duration.total;
    await checkpoint();return total.call(duration,{unit:'hours',relativeTo:'2024-03-09T12:00[America/New_York]'})`;
  const first = await run(source, { bindings: { checkpoint } });
  expect(first).toMatchObject({ ok: true, returnValue: 23 });
  const snapshot = JSON.parse(serializeSafeJSSnapshot(first.snapshot));
  expect(await run(source, { snapshot, bindings: { checkpoint } }))
    .toMatchObject({ ok: true, returnValue: 23 });
  expect(calls).toBe(1);
});

it.each([
  ["monthCode", "'M0X'", "nanosecond", "RangeError"],
  ["offset", "'+00:00[UTC]'", "second", "RangeError"],
  ["offset", "{[Symbol.toPrimitive](){return 0}}", "second", "TypeError"],
  ["timeZone", "{toString(){throw 'coerced'}}", "year", "TypeError"]
])("rejects invalid %s before later fields", async (field, value, later, expected) => {
  expect(await run(`const events=[];let name;try{new Temporal.Duration().total({
    relativeTo:{year:2024,month:1,day:1,${field}:${value},get ${later}(){events.push('later')}},
    get unit(){events.push('unit');return 'hours'}
  })}catch(error){name=error.name}return [name,events]`))
    .toMatchObject({ ok: true, returnValue: [expected, []] });
});
