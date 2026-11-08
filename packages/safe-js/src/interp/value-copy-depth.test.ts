import { expect, it } from "vitest";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";

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

it.each([1_024, 1_025])("round-trips mixed containers and collection properties at depth %s", (depth) => {
  let value = deepCopyFromSandbox(deepCopyToSandbox(nested(depth)));
  for (let index = 0; index < depth; index++) {
    if (Array.isArray(value)) value = value[0];
    else if (value !== null && typeof value === "object" && Object.hasOwn(value, "child"))
      value = (value as { child: unknown }).child;
    else if (value instanceof Map) value = value.get("child");
    else if (value instanceof Set) value = value.values().next().value;
    else throw new Error("Container shape changed");
  }
  expect(value).toBe("leaf");
});
