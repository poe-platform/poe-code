import { expect, it, vi } from "vitest";
import { decodeReplayData } from "./replay-data.js";
import { SnapshotValidationError } from "./validation.js";
import { isSandboxPromise, type SandboxValue } from "../interp/values.js";

it.each([undefined, null, 0, -1, 1.5, "1", NaN, Infinity])("rejects an invalid present scheduling identity %s", scheduleId => {
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7, scheduleId }
  ] })).toThrow(scheduleId === undefined ? SnapshotValidationError : TypeError);
});

it("does not schedule an imported Promise before the complete graph validates", () => {
  const schedule = vi.fn((_id: number, promise: Promise<SandboxValue>) => promise);
  const property = (id: number) => ({ value: { tag: "ref", id }, writable: true, enumerable: true, configurable: true });
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "object", properties: { first: property(1), invalid: property(9) }, extensible: true, nullPrototype: false },
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7, scheduleId: 2 }
  ] }, { restoreScheduledPromise: schedule })).toThrow(TypeError);
  expect(schedule).not.toHaveBeenCalled();
});

it("uses the scheduler only after successful graph reconstruction", async () => {
  const schedule = vi.fn((_id: number, promise: Promise<SandboxValue>) => promise);
  const value = decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7, scheduleId: 2 }
  ] }, { restoreScheduledPromise: schedule });
  if (!isSandboxPromise(value)) throw new Error("Expected Promise");
  await expect(value.promise).resolves.toBe(7);
  expect(schedule).toHaveBeenCalledExactlyOnceWith(2, expect.any(Promise), value);
});
