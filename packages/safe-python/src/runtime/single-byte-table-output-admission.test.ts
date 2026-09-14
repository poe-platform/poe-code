import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";

const codec = new SingleByteTableCodec(singleByteTables.find(table => table.name === "cp1252")!,
  new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000}));
const empty = new CodePointString(new Uint32Array());

it.each(["encode", "decode"] as const)("admits owned empty table %s results", operation => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 320});
  const retained: unknown[] = [];
  const run = () => operation === "encode" ? codec.encode(empty, "strict", meter)
    : codec.decode(new Uint8Array(), "strict", meter);
  let failure: unknown;
  try {
    for (let index = 0; index < 10; index++) retained.push(run());
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(retained.length).toBeLessThanOrEqual(3);
  expect(new Set(retained).size).toBe(retained.length);
  expect(run).toThrow(failure as Error);
});

it.each(["encode", "decode"] as const)("admits table %s result storage after recovery", operation => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 10000});
  let calls = 0;
  const recover = () => {
    calls++;
    meter.checkpoint(0, 10000 - meter.usage.allocatedBytes - 63);
  };
  const run = () => operation === "encode"
    ? codec.encode(new CodePointString(Uint32Array.of(0x100)), error => {
      recover();
      return {replacement: new Uint8Array(), position: error.end};
    }, meter)
    : codec.decode(Uint8Array.of(0x81), error => {
      recover();
      return {replacement: empty, position: error.end, input: error.object};
    }, meter);
  expect(run).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
});
