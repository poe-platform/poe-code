import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { readDurationRecord } from "./intl-duration-record.js";
import { createSandboxTemporalDuration, temporalDurationFields } from "./temporal-duration.js";
import { run } from "../run.js";

it("reads private Duration fields and returns an independent record", async () => {
  const duration = createSandboxTemporalDuration({ hours: 1, minutes: 2, seconds: 3 });
  const record = await readDurationRecord(duration, new Budget());
  expect(record).toEqual(temporalDurationFields(duration));
  record.hours = 9;
  expect(temporalDurationFields(duration).hours).toBe(1);
});

it("does not read public shadows on a privately branded Duration", async () => {
  const duration = createSandboxTemporalDuration({ hours: 1, minutes: 2 });
  let reads = 0;
  Object.defineProperties(duration, {
    hours: { get() { reads++; throw new Error("must not run"); } },
    minutes: { value: 999 }
  });
  expect(await readDurationRecord(duration, new Budget())).toEqual(temporalDurationFields(duration));
  expect(reads).toBe(0);
});

it("continues reading ordinary duration-like records", async () => {
  expect(await readDurationRecord({ hours: 1, minutes: 2 }, new Budget()))
    .toMatchObject({ hours: 1, minutes: 2, seconds: 0 });
  await expect(readDurationRecord({}, new Budget())).rejects.toThrow("at least one duration field");
});

it("formats Temporal Duration private fields through the public formatter", async () => {
  expect(await run(`const duration=new Temporal.Duration(0,0,0,0,1,2,3);
    Object.defineProperty(duration,'hours',{get(){throw 'must not run'}});
    return new Intl.DurationFormat('en-US',{style:'digital'}).format(duration);`))
    .toMatchObject({ ok: true, returnValue: "1:02:03" });
});
