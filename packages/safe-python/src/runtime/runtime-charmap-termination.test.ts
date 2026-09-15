import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

const paths = [
  {operation: "encode", source: "A", stop: 65, policy: "strict"},
  {operation: "encode", source: "AB", stop: 66, policy: "replace"},
  {operation: "encode", source: "A", stop: 63, policy: "replace"},
  {operation: "decode", source: "A", stop: 65, policy: "strict"},
  {operation: "decode", source: "BA", stop: 65, policy: "strict"},
] as const;

it.each(paths.flatMap(path => (["steps", "allocation", "cancelled"] as const).map(reason => ({...path, reason}))))(
  "preserves $reason termination in $operation of $source at mapping key $stop ($policy)",
  ({operation, source, stop, policy, reason}) => {
    const budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 2000000});
    const fatal = new ExecutionLimitError(reason);
    let terminated = false, workAfterTermination = 0;
    const meter = {checkpoint(steps?: number, bytes?: number) {
      if (terminated) {
        workAfterTermination++;
        throw new Error("work attempted after mapping terminated");
      }
      budget.checkpoint(steps, bytes);
    }};
    const values = new RuntimeValues(meter), keys: bigint[] = [];
    const mapping = values.builtinFunction({name: "mapping", invoke: () => values.none});
    const context: BuiltinInvocationContext = {
      isStopIteration: () => false,
      lookupSpecial: () => mapping,
      call(_fn, args) {
        if (args[0].kind !== "int") throw new Error("expected mapping key");
        keys.push(args[0].value);
        if (args[0].value === BigInt(stop)) {terminated = true; throw fatal;}
        return operation === "encode" ? values.none : values.integer(args[0].value);
      },
    };
    const codec = new RuntimeCharmap(values, meter);
    let failure: unknown;
    try {
      if (operation === "encode") codec.encode(CodePointString.fromString(source, meter), mapping, policy, context);
      else codec.decode(Uint8Array.from(source, char => char.charCodeAt(0)), mapping, policy, context);
    } catch (error) {failure = error;}
    expect(failure).toBe(fatal);
    expect(workAfterTermination).toBe(0);
    expect(keys).toEqual(stop === 66 ? [65n, 66n] : stop === 63 ? [65n, 63n] : source === "BA" ? [66n, 65n] : [65n]);
  },
);
