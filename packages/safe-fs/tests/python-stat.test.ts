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
