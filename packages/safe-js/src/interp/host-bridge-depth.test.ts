import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { copyHostValueToSandbox } from "./host-bridge.js";
import { deepCopyFromSandbox } from "./values.js";

function nested(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index++) {
    switch (index % 6) {
      case 0: value = [value]; break;
      case 1: value = { child: value }; break;
      case 2: value = new Map([["child", value]]); break;
      case 3: value = new Set([value]); break;
      case 4: value = Object.assign(new Map(), { child: value }); break;
      case 5: value = Object.assign(new Set(), { child: value }); break;
    }
  }
  return value;
}

it("imports deeply nested host containers and collection properties without native recursion", () => {
  const depth = 2500;
  let value = deepCopyFromSandbox(copyHostValueToSandbox(nested(depth), [], { budget: new Budget() }, { seen: new WeakMap() }, "<root>"));
  for (let index = 0; index < depth; index++) {
    if (Array.isArray(value)) value = value[0];
    else if (value !== null && typeof value === "object" && Object.hasOwn(value, "child")) value = (value as { child: unknown }).child;
    else if (value instanceof Map) value = value.get("child");
    else if (value instanceof Set) value = value.values().next().value;
    else throw new Error("Host container shape changed");
  }
  expect(value).toBe("leaf");
});

it("runs and resumes deep input with unlimited defaults", async () => {
  const source = "return 7;";
  let value: object = {};
  for (let index = 0; index < 1100; index++) value = { child: value };
  const result = await run(source, { bindings: { value } });
  expect(result).toMatchObject({ ok: true, returnValue: 7 });
  await expect(run(source, { snapshot: result.snapshot })).resolves.toMatchObject({ ok: true, returnValue: 7 });
});

it("preserves aliases, cycles and finite limits while copying host data", () => {
  const child = { text: "long" };
  const input: { left: object; right: object; self?: object } = { left: child, right: child };
  input.self = input;
  const copy = deepCopyFromSandbox(copyHostValueToSandbox(input, [], { budget: new Budget() }, { seen: new WeakMap() }, "<root>")) as typeof input;
  expect(copy.self).toBe(copy);
  expect(copy.left).toBe(copy.right);
  expect(copy.left).not.toBe(child);
  expect(() => copyHostValueToSandbox(input, [], { budget: new Budget({ stringLength: 3 }) }, { seen: new WeakMap() }, "<root>"))
    .toThrow(expect.objectContaining({ budget: "stringLength" }));
});
