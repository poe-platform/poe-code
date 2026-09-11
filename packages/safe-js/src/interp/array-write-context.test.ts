import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import * as accessors from "./accessors.js";

it("shares one call context across array-method writes", async () => {
  const write = vi.spyOn(accessors, "writePropertyDescriptor");
  try {
    const result = await run(`
    const seen=[], values=[0,0];
    Object.defineProperty(values,"0",{set(value){seen.push([0,value,this===values])}});
    Object.defineProperty(values,"1",{set(value){seen.push([1,value,this===values])}});
    values.fill(7);
    return seen;
  `);
    expect(result).toMatchObject({ok: true, returnValue: [[0,7,true],[1,7,true]]});
    const calls = write.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][3]).toBeDefined();
    expect(calls[0][3]).toBe(calls[1][3]);
  } finally { write.mockRestore(); }
});
