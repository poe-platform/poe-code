import { afterEach, expect, it, vi } from "vitest";
import { run } from "../run.js";
import { arrayMethodNames } from "./methods/array.js";

afterEach(() => vi.restoreAllMocks());

it("initializes guest array methods when newer native descriptors are absent", async () => {
  const descriptor = Object.getOwnPropertyDescriptor;
  vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((value, key) => {
    if (value === Array.prototype && ["toReversed", "toSorted", "toSpliced", "with"].includes(String(key))) return undefined;
    return descriptor(value, key);
  });
  expect(await run("return [Array.prototype.toReversed.length,Array.prototype.toSorted.length,Array.prototype.toSpliced.length,Array.prototype.with.length]"))
    .toMatchObject({ ok: true, returnValue: [0, 1, 2, 2] });
  expect(await run("const values=[3,1,2];return [values.toSorted(),values.toReversed(),values.toSpliced(1,1,7),values.with(-1,9),values]"))
    .toMatchObject({ ok: true, returnValue: [[1,2,3],[2,1,3],[3,7,2],[3,1,9],[3,1,2]] });
});

it("matches native argument-count metadata for every supported array method", async () => {
  const names = [...arrayMethodNames];
  const expected = names.map(name => Object.getOwnPropertyDescriptor(Array.prototype, name)!.value.length);
  expect(await run(`return ${JSON.stringify(names)}.map(name=>Array.prototype[name].length)`))
    .toMatchObject({ ok: true, returnValue: expected });
});
