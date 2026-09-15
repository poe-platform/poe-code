import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {MemoryByteStream} from "./memory-byte-stream.js";

it.each([0, 2])("admits the readinto source view before copying %i bytes", length => {
  const stream = new MemoryByteStream(Uint8Array.of(1, 2));
  const target = new Uint8Array(length).fill(9);
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 0});
  let failure: unknown;
  try { stream.readinto(target, meter); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(stream.tell()).toBe(0n);
  expect([...stream.getvalue()]).toEqual([1, 2]);
  expect([...target]).toEqual(new Array(length).fill(9));
  let retry: unknown;
  try { stream.readinto(target, meter); } catch (error) { retry = error; }
  expect(retry).toBe(failure);
});

it("bounds repeated EOF readinto views independently of the step allowance", () => {
  const stream = new MemoryByteStream();
  const target = Uint8Array.of(9);
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  let completed = 0, failure: unknown;
  try {
    for (; completed < 100; completed++) expect(stream.readinto(target, meter)).toBe(0n);
  } catch (error) { failure = error; }
  expect(failure).toMatchObject({reason: "allocation"});
  expect(completed).toBeGreaterThan(0);
  expect(completed).toBeLessThan(100);
  expect([...target]).toEqual([9]);
  expect(stream.tell()).toBe(0n);
  expect(() => stream.close()).not.toThrow();
});
