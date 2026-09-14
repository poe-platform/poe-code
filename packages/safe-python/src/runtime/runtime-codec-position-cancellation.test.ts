import {expect, it} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

const phases = ["handler", "index lookup", "index call", "warning"] as const;
const cases = (["encode", "decode"] as const).flatMap(operation =>
  phases.flatMap(phase => (["return", "ordinary failure", "guest failure", "fatal failure"] as const)
    .flatMap(outcome => [false, true].map(cancel => ({operation, phase, outcome, cancel})))));

it.each(cases)("$operation resume position: $phase / $outcome / cancel=$cancel", ({operation, phase, outcome, cancel}) => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal: controller.signal});
  const values = new RuntimeValues(meter);
  const registry = new RuntimeCodecRegistry(values, meter);
  const handler = values.cell({}), index = values.cell({});
  const replacement = values.string("?");
  const result = values.tuple([replacement, index]);
  const ordinary = new Error("position service failed");
  const guest = new PythonRuntimeError("ValueError", "position guest failed");
  const fatal = new ExecutionLimitError("allocation");
  const events: string[] = [];
  const visit = (current: typeof phases[number]) => {
    events.push(current);
    if (current !== phase) return;
    if (cancel) controller.abort();
    if (outcome === "ordinary failure") throw ordinary;
    if (outcome === "guest failure") throw guest;
    if (outcome === "fatal failure") throw fatal;
  };
  const context: BuiltinInvocationContext = {
    call(callback, args) {
      expect(callback).toBe(handler);
      expect(args).toEqual([values.none]);
      visit("handler");
      return result;
    },
    integerIndex: {
      integer(value) {return value.kind === "bool" ? value.value ? 1n : 0n : undefined;},
      isExactInteger: () => false,
      lookupIndex(value) {
        expect(value).toBe(index);
        visit("index lookup");
        return () => {visit("index call"); return values.boolean(true);};
      },
      typeName: value => value.kind,
      warn(category, message) {
        expect(category).toBe("DeprecationWarning");
        expect(message).toContain("__index__ returned non-int (type bool)");
        visit("warning");
      }
    }
  };
  const run = () => registry.handleError(handler, values.none, operation, 2, context);
  let caught: unknown, recovered: ReturnType<typeof run> | undefined;
  try {recovered = run();} catch (error) {caught = error;}
  if (outcome === "fatal failure") expect(caught).toBe(fatal);
  else if (cancel) expect(caught).toMatchObject({reason: "cancelled"});
  else if (outcome === "ordinary failure") expect(caught).toBe(ordinary);
  else if (outcome === "guest failure") expect(caught).toBe(guest);
  else {
    expect(caught).toBeUndefined();
    expect(recovered).toEqual({replacement, position: 1});
    expect(recovered!.replacement).toBe(replacement);
  }
  expect(events).toEqual(cancel || outcome !== "return" ? phases.slice(0, phases.indexOf(phase) + 1) : phases);
  if (cancel) {
    const before = [...events];
    expect(run).toThrow(ExecutionLimitError);
    expect(events).toEqual(before);
  }
});
