import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { writePropertyDescriptor } from "./accessors.js";

vi.mock("./accessors.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./accessors.js")>();
  return {...actual, writePropertyDescriptor: vi.fn(actual.writePropertyDescriptor)};
});

it("shares one call context across array-method writes", async () => {
  vi.mocked(writePropertyDescriptor).mockClear();
  const result = await run(`
    const seen=[], values=[0,0];
    Object.defineProperty(values,"0",{set(value){seen.push([0,value,this===values])}});
    Object.defineProperty(values,"1",{set(value){seen.push([1,value,this===values])}});
    values.fill(7);
    return seen;
  `);
  expect(result).toMatchObject({ok: true, returnValue: [[0,7,true],[1,7,true]]});
  const calls = vi.mocked(writePropertyDescriptor).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0][3]).toBeDefined();
  expect(calls[0][3]).toBe(calls[1][3]);
});
