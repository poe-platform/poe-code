import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {MemoryByteStream} from "./memory-byte-stream.js";

it.each(["getbuffer", "slice", "toreadonly"] as const)("admits %s allocation before retaining an export", operation => {
  const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
  const parent = operation === "getbuffer" ? undefined : stream.getbuffer();
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 0});
  const acquire = () => operation === "getbuffer" ? stream.getbuffer(meter)
    : operation === "slice" ? parent!.slice(null, null, -1n, meter) : parent!.toreadonly(meter);
  let failure: unknown;
  try { acquire(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try { acquire(); } catch (error) { retry = error; }
  expect(retry).toBe(failure);
  expect([...stream.getvalue()]).toEqual([1, 2, 3]);
  parent?.release();
  // A failed child must not leave an invisible export that prevents closure.
  expect(() => stream.close()).not.toThrow();
});

it("bounds repeated empty views and permits cleanup after allocation termination", () => {
  const stream = new MemoryByteStream();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const views = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) views.push(stream.getbuffer(meter));
  } catch (error) { failure = error; }
  expect(failure).toMatchObject({reason: "allocation"});
  expect(views.length).toBeGreaterThan(0);
  expect(views.length).toBeLessThan(100);
  for (const view of views) view.release();
  expect(() => stream.close()).not.toThrow();
});

it("does not publish a readinto prefix or move data when view allocation is denied", () => {
  const stream = new MemoryByteStream(new Uint8Array([1, 2, 3]));
  const target = stream.getbuffer();
  // No bytes need copying, but even an empty temporary view owns an export.
  stream.seek(3n);
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 0});
  expect(() => stream.readinto(target, meter)).toThrow(expect.objectContaining({reason: "allocation"}));
  expect(stream.tell()).toBe(3n);
  expect([...target.snapshot()]).toEqual([1, 2, 3]);
  target.release();
  expect(() => stream.close()).not.toThrow();
});
