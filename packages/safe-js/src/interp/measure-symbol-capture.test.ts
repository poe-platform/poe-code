import { expect, it, vi } from "vitest";
import { accessorAdapter } from "./accessors.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

it("does not allocate filtered symbol lists for internal-only closures", () => {
  const closure = createSandboxClosure({ call: () => undefined });
  const filter = vi.spyOn(Array.prototype, "filter");
  let calls: number;
  try {
    measureSandboxData([closure]);
    calls = filter.mock.calls.length;
  } finally {
    filter.mockRestore();
  }
  expect(calls).toBe(0);
});

it("captures symbol descriptors before retained callbacks mutate later properties", () => {
  const first = Symbol("a");
  const later = Symbol("b");
  const value = {
    [first]: createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        value[later] = "x".repeat(100);
        return [];
      }
    }),
    [later]: "initial"
  };
  expect(measureSandboxData([value])).toBe(15);
  expect(measureSandboxData([value])).toBe(108);
});

it("retains hidden symbol accessor captures without invoking the getter", () => {
  const call = vi.fn();
  const getter = createSandboxClosure({ call, retainedValues: () => ["retained"] });
  const value = Object.defineProperty({}, Symbol("hidden"), {
    get: accessorAdapter(getter, "get")
  });
  expect(measureSandboxData([value])).toBe(18);
  expect(call).not.toHaveBeenCalled();
});
