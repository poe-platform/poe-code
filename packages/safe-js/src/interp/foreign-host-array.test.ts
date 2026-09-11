import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../run.js";

it("admits a foreign array as host input", async () => {
  const value = runInNewContext("[1,2,3]");
  expect(await run("return [Array.isArray(value),value.join(',')]", { bindings: { value } }))
    .toMatchObject({ ok: true, returnValue: [true, "1,2,3"] });
});

it("admits foreign arrays returned by host callbacks", async () => {
  const value = runInNewContext("[1,2,3]");
  expect(await run("return (await read()).join(',')", { bindings: { read: async () => value } }))
    .toMatchObject({ ok: true, returnValue: "1,2,3" });
});

it("preserves holes, hidden indices, and cycles without copying the host prototype", async () => {
  const value = runInNewContext("class A extends Array{};const a=new A(3);Object.defineProperty(a,'1',{value:7});a[2]=a;a");
  expect(await run("return [value.length,0 in value,value[1],value[2]===value,Object.getPrototypeOf(value)===Array.prototype]", { bindings: { value } }))
    .toMatchObject({ ok: true, returnValue: [3, false, 7, true, true] });
});

it("rejects own array accessors without invoking them", async () => {
  const value = runInNewContext("[]");
  const read = vi.fn(() => "secret");
  Object.defineProperty(value, "0", { get: read });
  await expect(run("return value[0]", { bindings: { value } })).rejects.toThrow("accessor property");
  expect(read).not.toHaveBeenCalled();
});
