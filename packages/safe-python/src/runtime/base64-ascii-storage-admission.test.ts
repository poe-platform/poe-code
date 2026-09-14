import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

function fixture(input: string) {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  const values = new RuntimeValues(setup);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, setup));
  const decode = new Map(createRuntimeBase64Functions(values, setup)).get("a2b_base64")!;
  const source = values.string(input);
  return {run: (meter: ExecutionMeter) => decode.value.invoke([source], keywords, meter)};
}

it.each(["", "QQ==", "é", "\ud800"])("admits ASCII conversion storage before scanning %j", input => {
  const {run} = fixture(input);
  // Invocation and argument binding occupy 184 bytes. A payload-only budget
  // cannot also admit the independently owned ASCII conversion array.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 184 + input.length});
  expect(() => run(meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(184);
  expect(() => run(meter)).toThrow(ExecutionLimitError);
});

it.each(["", "QQ=="])("preserves cancellation at ASCII storage admission for %j", input => {
  const {run} = fixture(input), failure = new ExecutionLimitError("cancelled");
  const charges: number[] = [];
  const meter: ExecutionMeter = {checkpoint(_steps, bytes = 0) {
    if (bytes === 64 + input.length && charges.length === 2) throw failure;
    if (bytes !== 0) charges.push(bytes);
  }};
  let actual: unknown;
  try {run(meter);} catch (error) {actual = error;}
  expect(actual).toBe(failure);
  expect(charges).toEqual([96, 88]);
});

it.each([["", []], ["QQ==", [65]]] as const)("retains decoded bytes for %j with sufficient storage", (input, expected) => {
  const {run} = fixture(input);
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const result = run(meter);
  expect(result.kind).toBe("bytes");
  if (result.kind === "bytes") expect([...result.value.toUint8Array(meter)]).toEqual(expected);
});
