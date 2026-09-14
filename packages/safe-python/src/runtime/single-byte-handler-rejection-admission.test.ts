import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";

it.each(["xmlcharrefreplace", "namereplace"] as const)("admits %s decode rejection independently of the Unicode fault", policy => {
  const setup = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const codec = new SingleByteTableCodec(singleByteTables.find(table => table.name === "cp1252")!, setup);
  const input = Uint8Array.of(129);
  // Measure the storage for the underlying UnicodeDecodeError. Rejecting an
  // encode-only handler must also admit its separate TypeError allocation.
  const strict = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  expect(() => codec.decode(input, "strict", strict)).toThrow("character maps to <undefined>");
  const limited = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: strict.usage.allocatedBytes});
  let failure: unknown;
  try {codec.decode(input, policy, limited);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {codec.decode(input, policy, limited);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(() => codec.decode(input, policy, setup)).toThrow("don't know how to handle UnicodeDecodeError in error callback");
  expect([...codec.decode(Uint8Array.of(65), policy, setup).text]).toEqual([65]);
});
