import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

it.each(["a2b_base64", "b2a_base64"])("%s admits arity rejection and latches allocation failure", name => {
  for (const count of [0, 2, 3]) {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter);
    const fn = new Map(createRuntimeBase64Functions(values, meter)).get(name)!;
    const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
    const args = Array.from({length: count}, () => values.none);
    let calls = 0;
    const invoke = () => fn.value.invoke(args, keywords, meter, {call() {calls++; return values.none;}});
    meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 96);
    let failure: unknown;
    try {invoke();} catch (error) {failure = error;}
    expect(failure, `${count} positional arguments`).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    let retry: unknown;
    try {invoke();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(0);
  }
});

it.each(["a2b_base64", "b2a_base64"])("%s admits buffer rejection after the type-name service", name => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  const fn = new Map(createRuntimeBase64Functions(values, meter)).get(name)!;
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  const events: string[] = [];
  const invoke = () => fn.value.invoke([values.none], keywords, meter, {
    call() {throw Error("unexpected call");},
    buffers: {
      acquireSimple() {events.push("acquire"); return undefined;},
      typeName() {
        events.push("name");
        meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
        return "Exporter";
      }
    }
  });
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(events).toEqual(["acquire", "name"]);
});

it("a2b_base64 admits rejection of non-ASCII text", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  const fn = new Map(createRuntimeBase64Functions(values, meter)).get("a2b_base64")!;
  const source = values.string("é");
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 300);
  const invoke = () => fn.value.invoke([source], keywords, meter);
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});
