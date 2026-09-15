import { expect, it } from "vitest";
import { listRepresentation } from "./list-representation.js";
import { RepresentationStack } from "./representation-stack.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter), stack = new RepresentationStack<RuntimeValue>(100, meter);
  const context = createRuntimeRepresentationContext(v, meter, { defaultRepr: () => { throw Error("unexpected default"); } });
  const nativeRepr = context.lookupRepr;
  context.lookupRepr = value => value.kind === "list" ? () => v.stringPoints(listRepresentation(value, value.items, context, stack, meter)) : nativeRepr(value);
  const render = (value: ReturnType<typeof v.list>) => String.fromCodePoint(...listRepresentation(value, value.items, context, stack, meter));
  return { meter, v, stack, context, render };
}
it("renders empty, nested and heterogeneous lists using element repr", () => {
  const { v, render } = fixture();
  expect(render(v.list([]))).toBe("[]");
  expect(render(v.list([v.string("é"), v.integer(2), v.none, v.list([v.true])]))).toBe("['é', 2, None, [True]]");
});
it("marks direct and mutual cycles but renders repeated siblings fully", () => {
  const { v, render } = fixture(), a = v.list([]), b = v.list([a]);
  a.items.append(a); expect(render(a)).toBe("[[...]]");
  a.items.clear(); a.items.append(b); expect(render(a)).toBe("[[[...]]]");
  const child = v.list([v.integer(1)]); expect(render(v.list([child, child]))).toBe("[[1], [1]]");
});
it("observes appended elements and skips shifted elements after deletion", () => {
  for (const mode of ["append", "delete"] as const) {
    const { v, context, render } = fixture(), value = v.cell({}), list = v.list([value, v.integer(2)]), original = context.lookupRepr;
    context.lookupRepr = item => item === value ? () => { if (mode === "append") list.items.append(v.integer(3)); else list.items.delete(0n); return v.string("C"); } : original(item);
    expect(render(list)).toBe(mode === "append" ? "[C, 2, 3]" : "[C]");
  }
});
it("handles clearing and empty reentry before checking active-path cycles", () => {
  const { v, context, render } = fixture(), value = v.cell({}), list = v.list([value, v.integer(2)]), original = context.lookupRepr;
  context.lookupRepr = item => item === value ? () => { list.items.clear(); return v.string(render(list)); } : original(item);
  expect(render(list)).toBe("[[]]");
});
it("restores recursion state after an element repr fails", () => {
  const { v, context, render } = fixture(), value = v.cell({}), list = v.list([value]), error = new Error("guest repr"), original = context.lookupRepr;
  context.lookupRepr = item => item === value ? () => { throw error; } : original(item);
  expect(() => render(list)).toThrow(error);
  context.lookupRepr = item => item === value ? () => v.string("ok") : original(item);
  expect(render(list)).toBe("[ok]");
});
it("preserves separate surrogate code points and validates repr results", () => {
  const { v, context, render, stack, meter } = fixture(), value = v.cell({}), list = v.list([value]), original = context.lookupRepr;
  context.lookupRepr = item => item === value ? () => v.stringPoints(Uint32Array.of(0xd800, 0xdc00)) : original(item);
  expect([...listRepresentation(list, list.items, context, stack, meter)]).toEqual([91, 0xd800, 0xdc00, 93]);
  context.lookupRepr = item => item === value ? () => v.none : original(item);
  expect(() => render(list)).toThrow("__repr__ returned non-string (type NoneType)");
});
