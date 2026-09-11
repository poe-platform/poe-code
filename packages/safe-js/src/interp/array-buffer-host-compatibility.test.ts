import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it.each([
  ["resize", "resizable", "maxByteLength", "detached"],
  ["detached"]
])("supports fixed buffers without host methods %j", async (...missing) => {
  vi.resetModules();
  const descriptor = Object.getOwnPropertyDescriptor;
  vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((value, key) => {
    if (value === ArrayBuffer.prototype && missing.includes(String(key))) return undefined;
    return descriptor(value, key);
  });
  const { run } = await import("../run.js");
  expect(await run("const buffer=new ArrayBuffer(8);new Float32Array(buffer).set([1,2]);return Array.from(new Float32Array(buffer.slice(4)))"))
    .toMatchObject({ ok: true, returnValue: [2] });
  if (missing.includes("resize")) {
    expect(await run("try { new ArrayBuffer(8,{maxByteLength:16});return 'accepted'; } catch(error) { return error.name; }"))
      .toMatchObject({ ok: true, returnValue: "TypeError" });
  }
});
