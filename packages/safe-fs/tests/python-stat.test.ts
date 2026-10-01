import { expect, it } from "vitest";
import { PythonStatTranslator } from "../src/python/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

it("qualifies guest identities across backing namespaces without serializing authority", async () => {
  const first = new MemoryFileSystem();
  const second = new MemoryFileSystem();
  await first.writeFile("/file", new Uint8Array());
  await second.writeFile("/file", new Uint8Array());
  const a = await first.stat("/file");
  const b = await second.stat("/file");
  const translator = new PythonStatTranslator(2);
  const translated = translator.translate(a);
  expect(translated.ino).toBe(a.ino);
  expect(translated).not.toHaveProperty("identityScope");
  expect(translator.translate(a)).toEqual(translated);
  expect(translator.translate(b).dev).not.toBe(translated.dev);
  expect(() => translator.translate({ ...a, identityScope: Symbol() })).toThrowError(expect.objectContaining({ code: "EFBIG" }));
});

it("does not turn unqualified identifiers into guest identities", async () => {
  const fs = new MemoryFileSystem();
  const { identityScope: ignoredScope, ...stat } = await fs.stat("/");
  const translated = new PythonStatTranslator().translate(stat);
  expect(translated).not.toHaveProperty("ino");
  expect(translated).not.toHaveProperty("dev");
});

it.each([undefined, Infinity, 2048])("supports more than 1024 device identities with limit %s", async limit => {
  const stat = await new MemoryFileSystem().stat("/");
  const translator = new PythonStatTranslator(limit);
  for (let dev = 0; dev < 1025; dev++) {
    const input = { ...stat, dev };
    expect(translator.translate(input).dev).toBe(dev + 1);
    expect(translator.translate(input).dev).toBe(dev + 1);
  }
});

it.each([0, -1, NaN, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid device limit %s", limit => {
  expect(() => new PythonStatTranslator(limit)).toThrowError(expect.objectContaining({ code: "EINVAL" }));
});
