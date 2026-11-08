import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it.each([-1000001n, -1n, 0n, 1234567890n, 8640000000000000000000n])("formats private epoch %s with millisecond precision", async epoch => {
  const milliseconds = Number(epoch / 1000000n - (epoch < 0n && epoch % 1000000n !== 0n ? 1n : 0n));
  const options = { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 } as const;
  const expected = new Intl.DateTimeFormat("en-US", options).format(milliseconds);
  expect(await run(`const instant = new Temporal.Instant(${epoch}n);
    Object.defineProperty(instant, 'epochMilliseconds', {get(){throw 'public getter'}});
    instant.toString = () => {throw 'public conversion'};
    return instant.toLocaleString('en-US', ${JSON.stringify(options)})`))
    .toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  { timeZone: "UTC" },
  { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" },
  { timeZone: "UTC", fractionalSecondDigits: 3 },
  { timeZone: "UTC", era: "long" }
] as const)("applies locale defaults and styles for %j", async options => {
  // GetDateTimeFormat(required=any, defaults=all) does not count era as a
  // date/time component. Preserve the specified defaults for era-only input.
  const expected = new Date(0).toLocaleString("en-US", options);
  expect(await run(`return new Temporal.Instant(0n).toLocaleString('en-US', ${JSON.stringify(options)})`))
    .toMatchObject({ ok: true, returnValue: expected });
});

it("checks the private brand before touching locale or option properties", async () => {
  expect(await run(`const events=[];
    const input=new Proxy({}, {get(){events.push('get');throw 'read'}});
    const method=Temporal.Instant.prototype.toLocaleString;
    const results=[{}, new Proxy(new Temporal.Instant(0n), {})].map(value => {
      try { method.call(value,input,input); } catch(e) { return e.name; }
    }); return [results,events]`))
    .toMatchObject({ ok: true, returnValue: [["TypeError", "TypeError"], []] });
});

it("validates locales before options and stops at the first invalid option", async () => {
  expect(await run(`const events=[];const value=new Temporal.Instant(0n);let first,second;
    try { value.toLocaleString('not_a_locale', {get timeZone(){events.push('zone')}}); } catch(e){first=e.name}
    try { value.toLocaleString('en-US', {get localeMatcher(){events.push('matcher');return 'bad'},
      get calendar(){events.push('calendar')}}); } catch(e){second=e.name}
    return [first,second,events]`))
    .toMatchObject({ ok: true, returnValue: ["RangeError", "RangeError", ["matcher"]] });
});

it("has standard method metadata and is not a constructor", async () => {
  expect(await run(`const descriptor=Object.getOwnPropertyDescriptor(Temporal.Instant.prototype,'toLocaleString');
    const method=descriptor.value;let error;try {new method()}catch(e){error=e.name}
    return [method.name,method.length,descriptor.writable,descriptor.enumerable,descriptor.configurable,error]`))
    .toMatchObject({ ok: true, returnValue: ["toLocaleString", 0, true, false, true, "TypeError"] });
});

it("reads option keys once in specification order without enumeration", async () => {
  const keys = ["localeMatcher", "calendar", "numberingSystem", "hour12", "hourCycle", "timeZone", "weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName", "formatMatcher", "dateStyle", "timeStyle"];
  expect(await run(`const events=[];new Temporal.Instant(0n).toLocaleString('en-US',new Proxy({}, {
    get(target,key){events.push(key);return key==='timeZone'?'UTC':undefined},
    ownKeys(){throw 'enumerated'}
  }));return events`)).toMatchObject({ ok: true, returnValue: keys });
});

it("replays a retained locale method without repeating completed host calls", async () => {
  let calls = 0;
  const source = `const instant=new Temporal.Instant(-1n);
    const method=instant.toLocaleString;await checkpoint();
    return method.call(instant,'en-US',{timeZone:'UTC',fractionalSecondDigits:3})`;
  const checkpoint = async () => { calls++; };
  const first = await run(source, { bindings: { checkpoint } });
  expect(first).toMatchObject({ ok: true, returnValue: "999" });
  const snapshot = JSON.parse(serializeSafeJSSnapshot(first.snapshot));
  expect(await run(source, { snapshot, bindings: { checkpoint } }))
    .toMatchObject({ ok: true, returnValue: "999" });
  expect(calls).toBe(1);
});
