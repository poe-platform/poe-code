import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { temporalPlainYearMonthFields } from "./temporal-plain-year-month.js";

it("replays host year-month results without repeating the host call", async () => {
  let calls = 0;
  const load = () => { calls++; return new Backend.PlainYearMonth(2000, 2, "buddhist", 29); };
  const source = "const value=await load(); return [value,value];";
  const first = await run(source, { bindings: { load } });
  expect(first.ok).toBe(true);
  const replay = await run(source, { snapshot: JSON.parse(await dump(first)), bindings: { load } });
  expect(replay.ok).toBe(true);
  if (!replay.ok || !Array.isArray(replay.returnValue)) throw Error("Expected replay results");
  expect(replay.returnValue[0]).toBe(replay.returnValue[1]);
  expect(temporalPlainYearMonthFields(replay.returnValue[0])).toEqual({ isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" });
  expect(calls).toBe(1);
});

it("imports year-month bindings with private reference dates, aliases and frozen own state", async () => {
  const input = new Backend.PlainYearMonth(2000, 2, "buddhist", 29);
  Object.defineProperties(input, { day: { value: 7 }, self: { value: input } });
  Object.freeze(input);
  const result = await run("return [input.day,input.self===input,Object.isFrozen(input),input,input];", { bindings: { input } });
  expect(result).toMatchObject({ ok: true, returnValue: [7, true, true, expect.anything(), expect.anything()] });
  if (!result.ok || !Array.isArray(result.returnValue)) throw Error("Expected results");
  expect(result.returnValue[3]).toBe(result.returnValue[4]);
  expect(temporalPlainYearMonthFields(result.returnValue[3])).toEqual({ isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" });
});

it.each([[-271821, 4, 1], [275760, 9, 30]])("admits boundary year-month reference dates: %s-%s-%s", async (year, month, day) => {
  const result = await run("return input;", { bindings: { input: new Backend.PlainYearMonth(year, month, "iso8601", day) } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("Expected result");
  expect(temporalPlainYearMonthFields(result.returnValue)).toEqual({ isoYear: year, isoMonth: month, isoDay: day, calendar: "iso8601" });
});

it("rejects host year-month accessors without invoking them", async () => {
  const input = new Backend.PlainYearMonth(2000, 2);
  let reads = 0;
  Object.defineProperty(input, "label", { get() { reads++; return 1; } });
  await expect(run("return input;", { bindings: { input } })).rejects.toThrow(TypeError);
  expect(reads).toBe(0);
});

it("does not admit arbitrary host year-month symbol properties", async () => {
  const input = new Backend.PlainYearMonth(2000, 2);
  Object.defineProperty(input, Symbol("private"), { value: { secret: true } });
  await expect(run("return input;", { bindings: { input } })).rejects.toThrow(TypeError);
});
