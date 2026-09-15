import {expect, it} from "vitest";
import {MemoryByteStream} from "./memory-byte-stream.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";

it("bounds retained empty buffer snapshots", () => {
  const stream = new MemoryByteStream();
  const view = stream.getbuffer();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const retained: Uint8Array[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) retained.push(view.snapshot(meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(100);
  expect(new Set(retained).size).toBe(retained.length);
  view.release();
  stream.close();
});

it.each(["snapshot", "array assignment", "view assignment"])("admits buffer metadata before %s allocation and mutation", operation => {
  const stream = new MemoryByteStream(Uint8Array.of(1, 2, 3));
  const view = stream.getbuffer();
  const source = new MemoryByteStream(Uint8Array.of(9, 8, 7));
  const other = source.getbuffer();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 3});
  const act = () => operation === "snapshot" ? view.snapshot(meter)
    : view.assign(operation === "array assignment" ? Uint8Array.of(9, 8, 7) : other, meter);
  let failure: unknown;
  try {act();} catch (error) {failure = error;}
  expect(failure).toMatchObject({reason: "allocation"});
  expect(meter.usage.allocatedBytes).toBe(0);
  expect([...view.snapshot()]).toEqual([1, 2, 3]);
  let retry: unknown;
  try {act();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  view.release(); other.release();
  stream.close(); source.close();
});
