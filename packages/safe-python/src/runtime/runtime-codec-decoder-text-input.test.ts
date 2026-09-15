import {expect, it, vi} from "vitest";
import {ExecutionBudget} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

it.each(["", "text"])("rejects a native string subtype before buffer or codec services: %j", text => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 4000000});
  const values = new RuntimeValues(meter);
  const keys = {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b};
  const types = new RuntimeTypeRegistry(values, keys, meter);
  const namespace = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const subtype = types.publish(new RuntimeTypeLayout("Text", [types.stringType().value], namespace, meter), types.type);
  const source = values.instance(subtype, undefined, values.string(text));
  const codec = vi.fn(() => values.string("decoded"));
  const acquireSimple = vi.fn(() => undefined);
  const call = vi.fn(() => values.none);
  const decode = createRuntimeStringDecoder(codec, values);

  expect(() => decode(source, "unknown", "custom", meter, {call, buffers: {acquireSimple}})).toThrow(
    expect.objectContaining({name: "TypeError", message: "decoding str is not supported"})
  );
  expect(acquireSimple).not.toHaveBeenCalled();
  expect(codec).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
