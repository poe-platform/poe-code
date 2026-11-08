import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { temporalZonedDateTimeFields } from "./temporal-zoned-date-time.js";

it("imports zoned bindings and replays host results without repeating calls", async () => {
  const input = new Backend.ZonedDateTime(123n, "Europe/Warsaw", "buddhist");
  let calls = 0;
  const load = () => { calls++; return new Backend.ZonedDateTime(-456n, "+05:30"); };
  const source = "const loaded=await load(); return [input,loaded,input];";
  const first = await run(source, { bindings: { input, load } });
  expect(first.ok).toBe(true);
  if (!first.ok || !Array.isArray(first.returnValue)) throw Error("Expected results");
  expect(first.returnValue[0]).toBe(first.returnValue[2]);
  expect(temporalZonedDateTimeFields(first.returnValue[0])).toEqual({ epochNanoseconds: 123n, timeZone: "Europe/Warsaw", calendar: "buddhist" });
  expect(temporalZonedDateTimeFields(first.returnValue[1])).toEqual({ epochNanoseconds: -456n, timeZone: "+05:30", calendar: "iso8601" });
  const replay = await run(source, { snapshot: JSON.parse(await dump(first)), bindings: { load } });
  expect(replay.ok).toBe(true);
  if (!replay.ok || !Array.isArray(replay.returnValue)) throw Error("Expected replay results");
  expect(replay.returnValue[0]).toBe(replay.returnValue[2]);
  expect(replay.returnValue.map(temporalZonedDateTimeFields)).toEqual(first.returnValue.map(temporalZonedDateTimeFields));
  expect(calls).toBe(1);
});

it("preserves host own shadows, cycles and frozen state without replacing slots", async () => {
  const input = new Backend.ZonedDateTime(123n, "UTC");
  Object.defineProperties(input, { epochNanoseconds: { value: 7n }, self: { value: input } });
  Object.freeze(input);
  const result = await run("return [input.epochNanoseconds,input.self===input,Object.isFrozen(input),input];", { bindings: { input } });
  expect(result).toMatchObject({ ok: true, returnValue: [7n, true, true, expect.anything()] });
  if (!result.ok || !Array.isArray(result.returnValue)) throw Error("Expected results");
  expect(temporalZonedDateTimeFields(result.returnValue[3])?.epochNanoseconds).toBe(123n);
});

it("rejects host accessors without invoking them", async () => {
  const input = new Backend.ZonedDateTime(0n, "UTC");
  let reads = 0;
  Object.defineProperty(input, "label", { get() { reads++; return 1; } });
  await expect(run("return input;", { bindings: { input } })).rejects.toThrow(TypeError);
  expect(reads).toBe(0);
});

it("does not admit arbitrary host symbol properties", async () => {
  const input = new Backend.ZonedDateTime(0n, "UTC");
  Object.defineProperty(input, Symbol("private"), { value: { secret: true } });
  await expect(run("return input;", { bindings: { input } })).rejects.toThrow(TypeError);
});
