import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {RuntimeValues, type RuntimeValue, type BuiltinInvocationContext} from "./runtime-values.js";

for (const name of ["unicode_escape", "raw_unicode_escape"]) {
  it.each(["success", "bad-errors", "copy-failure", "cancel-acquire", "cancel-copy", "final-failure", "cancel-final"])(`${name} buffer lifetime: %s`, mode => {
    const controller = new AbortController();
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 2000000, signal: controller.signal});
    const values = new RuntimeValues(meter);
    const registry = new RuntimeCodecRegistry(values, meter);
    const decode = createRuntimeCoreCodecFunctions(registry).get(`${name}_decode`)!;
    const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
    const events: string[] = [];
    const source = values.cell({}), final = values.cell({});
    const failure = new Error("guest failure");
    const truth = values.builtinFunction({name: "__bool__", invoke() {
      events.push("final");
      if (mode === "cancel-final") controller.abort();
      if (mode === "final-failure") throw failure;
      return values.true;
    }});
    const context: BuiltinInvocationContext = {
      call(fn) {expect(fn).toBe(truth); return truth.value.invoke([], keywords, meter);},
      lookupSpecial(value, name) {return value === final && name === "__bool__" ? truth : undefined;},
      buffers: {acquireSimple(value) {
        expect(value).toBe(source);
        events.push("acquire");
        if (mode === "cancel-acquire") controller.abort();
        return {
          byteLength: 6,
          copy() {
            events.push("copy");
            if (mode === "copy-failure") throw failure;
            const bytes = ImmutableBytes.copyOf([92, 117, 50, 48, 97, 99], meter);
            if (mode === "cancel-copy") controller.abort();
            return bytes;
          },
          release() {events.push("release");}
        };
      }}
    };
    const invoke = () => decode.value.invoke([source, mode === "bad-errors" ? values.integer(1) : values.none, final], keywords, meter, context);
    if (mode === "success") {
      expect(invoke()).toEqual(values.tuple([values.string("€"), values.integer(6)]));
    } else {
      expect(invoke).toThrow(mode.startsWith("cancel") ? ExecutionLimitError : mode === "bad-errors" ? `${name}_decode() argument 2 must be str or None, not int` : failure);
    }
    expect(events).toEqual(mode === "bad-errors" || mode === "cancel-acquire" ? ["acquire", "release"] : mode === "final-failure" || mode === "cancel-final" ? ["acquire", "final", "release"] : ["acquire", "final", "copy", "release"]);
  });
}
