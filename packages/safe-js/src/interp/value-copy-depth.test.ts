import { expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
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

it("round-trips mixed containers and collection properties through the supported depth", () => {
  let value = deepCopyFromSandbox(deepCopyToSandbox(nested(MAX_DATA_DEPTH)));
  for (let index = 0; index < MAX_DATA_DEPTH; index++) {
    if (Array.isArray(value)) value = value[0];
    else if (value !== null && typeof value === "object" && Object.hasOwn(value, "child"))
      value = (value as { child: unknown }).child;
    else if (value instanceof Map) value = value.get("child");
    else if (value instanceof Set) value = value.values().next().value;
    else throw new Error("Container shape changed");
  }
  expect(value).toBe("leaf");
});

it("reports typed depth failures for mixed imports and exports", () => {
  const expected = expect.objectContaining({
    name: "SandboxError", budget: "dataDepth", current: MAX_DATA_DEPTH + 1, limit: MAX_DATA_DEPTH
  });
  expect(() => deepCopyToSandbox(nested(MAX_DATA_DEPTH + 1))).toThrow(expected);
  const value = deepCopyToSandbox(nested(MAX_DATA_DEPTH));
  expect(() => deepCopyFromSandbox([value])).toThrow(expected);
});
