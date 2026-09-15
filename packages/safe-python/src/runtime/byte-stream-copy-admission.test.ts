import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {MemoryByteStream} from "./memory-byte-stream.js";

const operations = ["read", "readline", "getvalue"] as const;

it.each(operations.flatMap(operation => [0, 2].map(length => ({operation, length}))))(
  "$operation admits owned buffer metadata for $length bytes before publication",
  ({operation, length}) => {
    const stream = new MemoryByteStream(new Uint8Array(length).fill(65));
    // Payload-only allowance must not admit a newly owned typed-array header.
    const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: length});
    const invoke = () => operation === "getvalue" ? stream.getvalue(meter) : stream.read(null, operation === "readline", meter);
    let failure: unknown;
    try { invoke(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(stream.tell()).toBe(0n);
    expect([...stream.getvalue()]).toEqual(new Array(length).fill(65));
    let retry: unknown;
    try { invoke(); } catch (error) { retry = error; }
    expect(retry).toBe(failure);
    stream.close();
  }
);

it.each(operations)("bounds repeated empty %s results independently of steps", operation => {
  const stream = new MemoryByteStream();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const retained: Uint8Array[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) retained.push(
      operation === "getvalue" ? stream.getvalue(meter) : stream.read(null, operation === "readline", meter)
    );
  } catch (error) { failure = error; }
  expect(failure).toMatchObject({reason: "allocation"});
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(100);
  expect(retained.every(bytes => bytes.length === 0)).toBe(true);
  expect(stream.tell()).toBe(0n);
  stream.close();
});

it.each(operations)("keeps %s storage and cursor unchanged on cancellation", operation => {
  const stream = new MemoryByteStream(Uint8Array.of(65, 10, 66));
  stream.seek(1n);
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 1024, signal: controller.signal});
  controller.abort();
  const invoke = () => operation === "getvalue" ? stream.getvalue(meter) : stream.read(null, operation === "readline", meter);
  let failure: unknown;
  try { invoke(); } catch (error) { failure = error; }
  expect(failure).toMatchObject({reason: "cancelled"});
  expect(stream.tell()).toBe(1n);
  expect([...stream.getvalue()]).toEqual([65, 10, 66]);
  let retry: unknown;
  try { invoke(); } catch (error) { retry = error; }
  expect(retry).toBe(failure);
  stream.close();
});
