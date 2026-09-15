import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {decodeUtf7} from "./utf7.js";

const cases = (["xmlcharrefreplace", "namereplace"] as const).flatMap(policy =>
  [[255], [43, 65, 45], [43, 65]].map(bytes => ({policy, bytes})),
);

it.each(cases)("admits UTF-7 $policy rejection for $bytes before exposing a guest fault", ({policy, bytes}) => {
  // Leave room for the scratch buffer but none for the exception. All three
  // paths (direct byte, terminated shift, final shift) must remain fatal.
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64 + bytes.length * 4});
  let failure: unknown;
  try {decodeUtf7(Uint8Array.from(bytes), policy, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {decodeUtf7(Uint8Array.of(65), "strict", meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(cases)("preserves the pinned UTF-7 $policy rejection for $bytes", ({policy, bytes}) => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 4096});
  let failure: unknown;
  try {decodeUtf7(Uint8Array.from(bytes), policy, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(PythonRuntimeError);
  expect(failure).toMatchObject({name: "TypeError", argumentMessage: "don't know how to handle UnicodeDecodeError in error callback"});
  // The policy is consulted only on a fault, including for incremental input.
  expect([...decodeUtf7(Uint8Array.of(65), policy, meter).text]).toEqual([65]);
  expect(decodeUtf7(Uint8Array.of(43, 65), policy, meter, false).consumed).toBe(0);
});
