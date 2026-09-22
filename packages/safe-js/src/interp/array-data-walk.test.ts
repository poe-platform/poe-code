import { expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { markDescriptorObject } from "./object-model.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

function chain(depth: number, managed: boolean, childFirst: boolean, mixed: boolean): object {
  let root: object = {};
  for (let index = 0; index < depth; index++) {
    if (mixed && index % 2 === 1)
      root = childFirst ? { next: root, padding: "x" } : { padding: "x", next: root };
    else {
      const next = childFirst ? [root, "x"] : ["x", root];
      if (managed) markDescriptorObject(next);
      root = next;
    }
  }
  return root;
}

for (const managed of [false, true])
  for (const childFirst of [false, true])
    for (const mixed of [false, true]) {
      it(`keeps array depth and units on the default stack (managed=${managed}, childFirst=${childFirst}, mixed=${mixed})`, () => {
        // Arrays contribute four units, or eight with managed index keys. Records
        // contribute fifteen; the leaf contributes one. No depth is charged for keys.
        const arrayUnits = managed ? 8 : 4;
        const units =
          1 + (mixed ? (MAX_DATA_DEPTH / 2) * (arrayUnits + 15) : MAX_DATA_DEPTH * arrayUnits);
        expect(measureSandboxData([chain(MAX_DATA_DEPTH, managed, childFirst, mixed)])).toBe(units);
        expect(() =>
          measureSandboxData([chain(MAX_DATA_DEPTH + 1, managed, childFirst, mixed)])
        ).toThrow(
          expect.objectContaining({
            code: "budgetExceeded",
            budget: "dataDepth"
          })
        );
      });
    }

it("captures managed named accessors before callbacks and never invokes their getters", () => {
  const array: unknown[] = [];
  let reads = 0;
  const first = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      array.length = 0;
      Object.defineProperty(array, "hidden", {
        value: "changed!",
        configurable: true
      });
      return [];
    }
  });
  array.push(first, "initial");
  Object.defineProperty(array, "hidden", {
    value: "original",
    configurable: true
  });
  Object.defineProperty(array, "getter", {
    get() {
      reads++;
      throw new Error("getter invoked");
    },
    configurable: true
  });
  markDescriptorObject(array);
  expect(measureSandboxData([array])).toBe(37);
  expect(reads).toBe(0);
});
