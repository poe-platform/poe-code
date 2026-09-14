import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

function fixture(name: string) {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  const fn = new Map(createRuntimeHexadecimalFunctions(values, meter)).get(name)!;
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  return {meter, values, fn, keywords};
}

function expectTerminal(invoke: () => unknown) {
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect.soft(failure).toBeInstanceOf(ExecutionLimitError);
  expect.soft(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect.soft(retry).toBe(failure);
}

it.each(["hexlify", "b2a_hex", "unhexlify", "a2b_hex"])("%s admits argument rejection", name => {
  for (const count of [0, 4]) {
    const {meter, values, fn, keywords} = fixture(name);
    const args = Array.from({length: count}, () => values.none);
    meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 200);
    expectTerminal(() => fn.value.invoke(args, keywords, meter));
  }
});

it.each(["unhexlify", "a2b_hex"])("%s admits keyword and non-ASCII rejection", name => {
  for (const keyword of [false, true]) {
    const {meter, values, fn, keywords} = fixture(name);
    const source = values.string("é");
    if (keyword) keywords.items.set(values.string("hexstr"), source);
    meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 200);
    expectTerminal(() => fn.value.invoke([source], keywords, meter));
  }
});

it.each(["hexlify", "b2a_hex", "unhexlify", "a2b_hex"])("%s admits missing-buffer diagnostics after name service exhaustion", name => {
  for (const raises of [false, true]) {
    if (raises && (name === "hexlify" || name === "b2a_hex")) continue;
    const {meter, values, fn, keywords} = fixture(name);
    const events: string[] = [];
    const failure = new PythonRuntimeError("TypeError", "export rejected");
    expectTerminal(() => fn.value.invoke([values.none], keywords, meter, {
      call() {throw Error("unexpected guest call");},
      buffers: {
        acquireSimple() {events.push("acquire"); if (raises) throw failure; return undefined;},
        typeName() {
          events.push("name");
          meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
          return "Exporter";
        }
      }
    }));
    expect(events).toEqual(["acquire", "name"]);
  }
});

it.each(["hexlify", "b2a_hex"])("%s admits separator and grouping errors while releasing the input", name => {
  for (const rejection of ["group", "length", "type", "ascii"] as const) {
    const {meter, values, fn, keywords} = fixture(name);
    const input = values.bytes(Uint8Array.of(65));
    const separator = rejection === "length" ? values.string("") : rejection === "type" ? values.list([values.none]) : values.string("Ā");
    const group = values.integer(rejection === "group" ? 2147483648n : 1n);
    const events: string[] = [];
    expectTerminal(() => fn.value.invoke([values.none, separator, group], keywords, meter, {
      call() {throw Error("unexpected guest call");},
      buffers: {
        acquireSimple() {
          events.push("acquire");
          meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
          return {byteLength: 1, copy() {events.push("copy"); return input.value;}, release() {events.push("release");}};
        }
      }
    }));
    expect(events).toEqual(["acquire", "release"]);
  }
});
