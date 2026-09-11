import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it.each([
  ["'PT1H'", "{minutes:60}", "undefined", 0],
  ["{seconds:-2}", "{seconds:-1}", "undefined", -1],
  ["{seconds:9007199254740990,nanoseconds:1}", "{seconds:9007199254740990}", "undefined", 1],
  ["{months:1}", "{days:29}", "{relativeTo:'2024-01-31'}", 0],
  ["{months:1}", "{days:29}", "{relativeTo:'2023-01-31'}", -1],
  ["{days:1}", "{hours:24}", "{relativeTo:'2024-03-09T12:00[America/New_York]'}", -1],
  ["{days:1}", "{hours:24}", "{relativeTo:'2024-11-02T12:00[America/New_York]'}", 1],
  ["{years:1}", "{days:366}", "{relativeTo:{year:2024,month:1,day:1}}", 0],
  ["{months:1}", "{months:1}", "undefined", 0]
] as const)("compares %s and %s with %s", async (one, two, options, expected) => {
  expect(await run(`return Temporal.Duration.compare(${one},${two},${options})`))
    .toMatchObject({ ok: true, returnValue: expected });
});

it("converts both operands before reading relativeTo", async () => {
  expect(await run(`const events=[];
    const one={get seconds(){events.push('one');return 1}};
    const two={get seconds(){events.push('two');return 2}};
    const options={get relativeTo(){events.push('relativeTo');return '2024-01-01'}};
    return [Temporal.Duration.compare(one,two,options),events]`))
    .toMatchObject({ ok: true, returnValue: [-1, ["one", "two", "relativeTo"]] });
});

it("does not shortcut invalid options or relativeTo for equal operands", async () => {
  expect(await run(`return [null,1,{relativeTo:'invalid'}].map(options=>{
    try{Temporal.Duration.compare('PT0S','PT0S',options)}catch(e){return e.name}
  })`)).toMatchObject({ ok: true, returnValue: ["TypeError", "TypeError", "RangeError"] });
});

it("stops at the first invalid operand", async () => {
  expect(await run(`const events=[];let name;try{Temporal.Duration.compare('invalid',
    {get seconds(){events.push('two')}},{get relativeTo(){events.push('relativeTo')}})
  }catch(e){name=e.name}return [name,events]`))
    .toMatchObject({ ok: true, returnValue: ["RangeError", []] });
});

it("requires relativeTo for unequal calendar durations", async () => {
  expect(await run(`let name;try{Temporal.Duration.compare({months:1},{months:2})}catch(e){name=e.name}return name`))
    .toMatchObject({ ok: true, returnValue: "RangeError" });
});

it("uses private fields and ignores its own receiver", async () => {
  expect(await run(`const one=Temporal.Duration.from({hours:1});
    Object.defineProperty(one,'hours',{get(){throw 'public getter'}});
    return Temporal.Duration.compare.call(null,one,'PT60M')`))
    .toMatchObject({ ok: true, returnValue: 0 });
});

it("has standard metadata and is not constructable", async () => {
  expect(await run(`const descriptor=Object.getOwnPropertyDescriptor(Temporal.Duration,'compare');
    const method=descriptor.value;let name;try{new method()}catch(e){name=e.name}
    return [method.name,method.length,descriptor.writable,descriptor.enumerable,descriptor.configurable,name]`))
    .toMatchObject({ ok: true, returnValue: ["compare", 2, true, false, true, "TypeError"] });
});

it("replays a captured compare method without repeating a completed host call", async () => {
  let calls=0;
  const checkpoint=async()=>{calls++;};
  const source=`const compare=Temporal.Duration.compare;await checkpoint();
    return compare({days:1},{hours:24},{relativeTo:'2024-03-09T12:00[America/New_York]'})`;
  const first=await run(source,{bindings:{checkpoint}});
  expect(first).toMatchObject({ok:true,returnValue:-1});
  const snapshot=JSON.parse(serializeSafeJSSnapshot(first.snapshot));
  expect(await run(source,{bindings:{checkpoint},snapshot})).toMatchObject({ok:true,returnValue:-1});
  expect(calls).toBe(1);
});
